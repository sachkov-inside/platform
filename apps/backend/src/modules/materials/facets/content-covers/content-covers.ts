import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import {
  Prisma,
  type MaterialsPrismaClient,
  type MaterialsPrisma,
  type MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import { processMaterialAssetBytes } from "../../../assets/index.js";
import type { AuthorPolicy } from "../../ports/author-policy.js";
import { authorizeManager } from "../../ports/author-policy.js";

export type ContentCoverOwner = Readonly<{
  id: string;
  kind: "material" | "series" | "topic";
}>;

export interface ContentCoverProjection {
  readonly coverId: string;
  readonly renditions: readonly {
    readonly height: number;
    readonly width: number;
  }[];
}

export type ChangeContentCoverCommand =
  | Readonly<{
      actor: string;
      body: Uint8Array;
      declaredContentType: string;
      declaredSize: number;
      expectedChecksumSha256: string;
      expectedCoverId: string | null;
      filename: string;
      kind: "upload";
      owner: ContentCoverOwner;
    }>
  | Readonly<{
      actor: string;
      expectedCoverId: string | null;
      kind: "remove";
      owner: ContentCoverOwner;
    }>;

export type ChangeContentCoverResult =
  | Readonly<{
      ok: true;
      value: { readonly cover: ContentCoverProjection | null };
    }>
  | Readonly<{
      ok: false;
      error:
        | { readonly code: "conflict"; readonly currentCoverId: string | null }
        | { readonly code: "dependency_unavailable"; readonly retryable: true }
        | { readonly code: "forbidden" }
        | { readonly code: "invalid_cover" }
        | { readonly code: "owner_not_found" };
    }>;

export type DeliverContentCoverResult =
  | Readonly<{
      ok: true;
      body: Uint8Array;
      contentLength: number;
      contentType: string;
    }>
  | Readonly<{
      ok: false;
      error: { readonly code: "dependency_unavailable" | "not_found" };
    }>;

export interface ContentCovers {
  readonly change: (
    command: ChangeContentCoverCommand,
  ) => Promise<ChangeContentCoverResult>;
  readonly deliver: (input: {
    readonly coverId: string;
    readonly width: number;
  }) => Promise<DeliverContentCoverResult>;
}

export const CONTENT_COVERS = Symbol("CONTENT_COVERS");

export async function loadContentCoverProjections(
  prisma: MaterialsPrisma,
  coverIds: readonly string[],
): Promise<ReadonlyMap<string, ContentCoverProjection>> {
  if (coverIds.length === 0) return new Map();
  const covers = await prisma.contentCover.findMany({
    where: {
      id: { in: [...new Set(coverIds)] },
      currentlyReferenced: true,
      state: "ready",
    },
    include: { renditions: { orderBy: { width: "asc" } } },
  });
  return new Map(
    covers.map((cover) => [
      cover.id,
      {
        coverId: cover.id,
        renditions: cover.renditions.map(({ height, width }) => ({ height, width })),
      },
    ]),
  );
}

const commonCommandSchema = z.object({
  actor: z.uuid(),
  expectedCoverId: z.uuid().nullable(),
  owner: z
    .object({ id: z.uuid(), kind: z.enum(["material", "series", "topic"]) })
    .strict(),
});
const commandSchema = z.discriminatedUnion("kind", [
  commonCommandSchema
    .extend({
      body: z.instanceof(Uint8Array),
      declaredContentType: z.string().min(1).max(255),
      declaredSize: z.number().int().positive(),
      expectedChecksumSha256: z.hash("sha256"),
      filename: z.string().min(1).max(255),
      kind: z.literal("upload"),
    })
    .strict(),
  commonCommandSchema.extend({ kind: z.literal("remove") }).strict(),
]);
const deliverySchema = z
  .object({ coverId: z.uuid(), width: z.number().int().positive() })
  .strict();

export function assembleContentCovers(dependencies: {
  readonly authorPolicy: AuthorPolicy;
  readonly objectStorage: ObjectStorage;
  readonly prisma: MaterialsPrismaClient;
}): ContentCovers {
  return {
    async change(input) {
      const parsed = commandSchema.safeParse(input);
      if (!parsed.success) return failure("invalid_cover");
      const authorization = await authorizeManager(
        dependencies.authorPolicy,
        parsed.data.actor,
      );
      if (!authorization.ok) return { ok: false, error: authorization.error };
      try {
        if (parsed.data.kind === "remove") {
          return await changeCurrentCover(dependencies.prisma, parsed.data, null);
        }
        const processed = await processMaterialAssetBytes({
          body: parsed.data.body,
          declaredContentType: parsed.data.declaredContentType,
          declaredSize: parsed.data.declaredSize,
          expectedChecksumSha256: parsed.data.expectedChecksumSha256,
          filename: parsed.data.filename,
          kind: "image",
        });
        if (!processed.ok || processed.value.kind !== "image") {
          return failure("invalid_cover");
        }
        const coverId = randomUUID();
        const prefix = `content-covers/${parsed.data.owner.kind}/${parsed.data.owner.id}/${coverId}`;
        const renditions = processed.value.variants.map((variant) => ({
          body: variant.body,
          byteSize: variant.body.byteLength,
          checksumSha256: createHash("sha256").update(variant.body).digest("hex"),
          contentType: variant.contentType,
          height: variant.height,
          publicObjectKey: `${prefix}/${variant.width}.webp`,
          width: variant.width,
        }));
        await dependencies.prisma.contentCover.create({
          data: {
            id: coverId,
            ...ownerColumns(parsed.data.owner),
            state: "processing",
            renditions: {
              createMany: {
                data: renditions.map(({ body: _body, ...row }) => row),
              },
            },
          },
        });
        try {
          const outcomes = await Promise.allSettled(
            renditions.map(({ body, ...rendition }) =>
              dependencies.objectStorage.putImmutable({
                body,
                checksumSha256: rendition.checksumSha256,
                contentType: rendition.contentType,
                key: rendition.publicObjectKey,
                namespace: "public",
              }),
            ),
          );
          if (
            outcomes.some(
              (outcome) =>
                outcome.status === "rejected" ||
                (outcome.status === "fulfilled" && !outcome.value.ok),
            )
          ) {
            throw new Error("Content cover storage failed");
          }
        } catch {
          await dependencies.prisma.contentCover.updateMany({
            data: {
              failureCode: "storage_failure",
              state: "failed",
              updatedAt: new Date(),
            },
            where: { id: coverId, state: "processing" },
          });
          return dependencyUnavailable();
        }
        return await changeCurrentCover(dependencies.prisma, parsed.data, coverId);
      } catch {
        return dependencyUnavailable();
      }
    },

    async deliver(input) {
      const parsed = deliverySchema.safeParse(input);
      if (!parsed.success) return notFound();
      try {
        const rendition = await dependencies.prisma.contentCoverRendition.findUnique({
          where: {
            coverId_width: {
              coverId: parsed.data.coverId,
              width: parsed.data.width,
            },
          },
          include: {
            cover: {
              select: { currentlyReferenced: true, state: true },
            },
          },
        });
        if (
          rendition === null ||
          rendition.cover.state !== "ready" ||
          !rendition.cover.currentlyReferenced
        ) {
          return notFound();
        }
        const object = await dependencies.objectStorage.read(
          "public",
          rendition.publicObjectKey,
        );
        return object === null
          ? notFound()
          : {
              body: object.body,
              contentLength: object.contentLength,
              contentType: object.contentType,
              ok: true,
            };
      } catch {
        return { ok: false, error: { code: "dependency_unavailable" } };
      }
    },
  };
}

async function changeCurrentCover(
  prisma: MaterialsPrismaClient,
  command: z.infer<typeof commandSchema>,
  nextCoverId: string | null,
): Promise<ChangeContentCoverResult> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`${command.owner.kind}:${command.owner.id}`}, 0)
      )
    `);
    const currentCoverId = await readCurrentCoverId(transaction, command.owner);
    if (currentCoverId === undefined) {
      if (nextCoverId !== null) await abandonCover(transaction, nextCoverId, "owner_not_found");
      return failure("owner_not_found");
    }
    if (currentCoverId !== command.expectedCoverId) {
      if (nextCoverId !== null) await abandonCover(transaction, nextCoverId, "conflict");
      return {
        ok: false,
        error: { code: "conflict", currentCoverId },
      };
    }
    await writeCurrentCoverId(transaction, command.owner, nextCoverId);
    const now = new Date();
    if (nextCoverId !== null) {
      await transaction.contentCover.update({
        data: {
          currentlyReferenced: true,
          failureCode: null,
          readyAt: now,
          state: "ready",
          updatedAt: now,
        },
        where: { id: nextCoverId },
      });
    }
    if (currentCoverId !== null) {
      await transaction.contentCover.updateMany({
        data: {
          currentlyReferenced: false,
          orphanedAt: now,
          updatedAt: now,
        },
        where: { id: currentCoverId },
      });
    }
    return {
      ok: true,
      value: {
        cover:
          nextCoverId === null
            ? null
            : await projectCover(transaction, nextCoverId),
      },
    };
  });
}

async function readCurrentCoverId(
  transaction: MaterialsPrismaTransaction,
  owner: ContentCoverOwner,
): Promise<string | null | undefined> {
  switch (owner.kind) {
    case "material":
      return (
        await transaction.material.findUnique({
          where: { id: owner.id },
          select: { coverId: true },
        })
      )?.coverId;
    case "topic":
      return (
        await transaction.topic.findUnique({
          where: { id: owner.id },
          select: { coverId: true },
        })
      )?.coverId;
    case "series":
      return (
        await transaction.series.findUnique({
          where: { id: owner.id },
          select: { coverId: true },
        })
      )?.coverId;
  }
}

async function writeCurrentCoverId(
  transaction: MaterialsPrismaTransaction,
  owner: ContentCoverOwner,
  coverId: string | null,
): Promise<void> {
  switch (owner.kind) {
    case "material":
      await transaction.material.update({
        data: { coverId, updatedAt: new Date() },
        where: { id: owner.id },
      });
      await transaction.publishedMaterial.updateMany({
        data: { coverId },
        where: { materialId: owner.id },
      });
      return;
    case "topic":
      await transaction.topic.update({
        data: { coverId, updatedAt: new Date() },
        where: { id: owner.id },
      });
      return;
    case "series":
      await transaction.series.update({
        data: { coverId, updatedAt: new Date() },
        where: { id: owner.id },
      });
  }
}

async function projectCover(
  transaction: MaterialsPrismaTransaction,
  coverId: string,
): Promise<ContentCoverProjection> {
  const cover = await transaction.contentCover.findUniqueOrThrow({
    where: { id: coverId },
    include: { renditions: { orderBy: { width: "asc" } } },
  });
  return {
    coverId,
    renditions: cover.renditions.map(({ height, width }) => ({ height, width })),
  };
}

async function abandonCover(
  transaction: MaterialsPrismaTransaction,
  coverId: string,
  failureCode: string,
): Promise<void> {
  await transaction.contentCover.updateMany({
    data: { failureCode, state: "failed", updatedAt: new Date() },
    where: { id: coverId, state: "processing" },
  });
}

function ownerColumns(owner: ContentCoverOwner) {
  return {
    materialId: owner.kind === "material" ? owner.id : null,
    seriesId: owner.kind === "series" ? owner.id : null,
    topicId: owner.kind === "topic" ? owner.id : null,
  };
}

function failure(
  code: "forbidden" | "invalid_cover" | "owner_not_found",
): ChangeContentCoverResult {
  return { ok: false, error: { code } };
}

function dependencyUnavailable(): ChangeContentCoverResult {
  return {
    ok: false,
    error: { code: "dependency_unavailable", retryable: true },
  };
}

function notFound(): DeliverContentCoverResult {
  return { ok: false, error: { code: "not_found" } };
}
