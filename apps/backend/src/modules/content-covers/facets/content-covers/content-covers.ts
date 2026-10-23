import { createHash, randomUUID } from "node:crypto";

import { z } from "zod";

import type { ObjectStorage } from "../../../../infrastructure/object-storage/index.js";
import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import { lockContentCoverOwner } from "../../../../infrastructure/prisma/index.js";
import { processMaterialAssetBytes } from "../../../assets/index.js";
import type { ContentCoverSelection } from "./cover-selection.js";
import {
  type ContentCoversPersistenceClient,
  type ContentCoversPersistence,
} from "../../infrastructure/prisma.js";
import {
  transactionHandle,
  type TransactionHandle,
} from "../../../../infrastructure/prisma/transaction-handle.js";
import { loadContentCoverProjections } from "../../infrastructure/postgres/content-cover-projections.js";
interface AuthorPolicy {
  canManage(
    actor: string,
    transaction?: TransactionHandle,
  ): boolean | Promise<boolean>;
}

export const contentCoverOwnerKindSchema = z.enum([
  "material",
  "series",
  "topic",
]);

export type ContentCoverOwnerKind = z.infer<typeof contentCoverOwnerKindSchema>;

export type ContentCoverOwner = Readonly<{
  id: string;
  kind: ContentCoverOwnerKind;
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
  /** Changes the cover of a Material or Product owned by exactly this authoring source. */
  readonly changeImported: (
    command: ChangeContentCoverCommand,
    sourceId: string,
  ) => Promise<ChangeContentCoverResult>;
  readonly loadProjections: (
    coverIds: readonly string[],
    transaction?: TransactionHandle,
  ) => Promise<ReadonlyMap<string, ContentCoverProjection>>;
  readonly deliver: (input: {
    readonly coverId: string;
    readonly width: number;
  }) => Promise<DeliverContentCoverResult>;
}

export const CONTENT_COVERS = Symbol("CONTENT_COVERS");

const commonCommandSchema = z.object({
  actor: z.uuid(),
  expectedCoverId: z.uuid().nullable(),
  owner: z.object({ id: z.uuid(), kind: contentCoverOwnerKindSchema }).strict(),
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
  readonly prisma: ContentCoversPersistenceClient;
  readonly selection: ContentCoverSelection;
}): ContentCovers {
  async function change(
    input: ChangeContentCoverCommand,
    sourceId: string | null,
  ): Promise<ChangeContentCoverResult> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) return failure("invalid_cover");
    try {
      if (!(await dependencies.authorPolicy.canManage(parsed.data.actor)))
        return failure("forbidden");
    } catch (error) {
      return dependencyFailure(
        { module: "content-covers", operation: "authorizeManager" },
        error,
        dependencyUnavailable(),
      );
    }
    try {
      if (parsed.data.kind === "remove") {
        return await changeCurrentCover(
          dependencies,
          parsed.data,
          null,
          sourceId,
        );
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
            (outcome) => outcome.status === "rejected" || !outcome.value.ok,
          )
        ) {
          throw new Error("Content cover storage failed");
        }
        // A rejected/unknown PUT can still complete remotely. Confirm only
        // successful writes, even when cleanup has already claimed this row.
        await dependencies.prisma.contentCover.update({
          where: { id: coverId },
          data: { uploadConfirmed: true },
        });
      } catch (error) {
        reportDependencyFailure(
          { module: "content-covers", operation: "change" },
          error,
        );
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
      return await changeCurrentCover(
        dependencies,
        parsed.data,
        coverId,
        sourceId,
      );
    } catch (error) {
      return dependencyFailure(
        { module: "content-covers", operation: "change" },
        error,
        dependencyUnavailable(),
      );
    }
  }
  return {
    change: (input) => change(input, null),
    changeImported: (input, sourceId) => change(input, sourceId),
    loadProjections: (ids, handle) =>
      loadContentCoverProjections(
        handle ?? transactionHandle(dependencies.prisma),
        ids,
      ),
    async deliver(input) {
      const parsed = deliverySchema.safeParse(input);
      if (!parsed.success) return notFound();
      try {
        const rendition =
          await dependencies.prisma.contentCoverRendition.findUnique({
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
          rendition?.cover.state !== "ready" ||
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
      } catch (error) {
        return dependencyFailure(
          { module: "content-covers", operation: "deliver" },
          error,
          { ok: false, error: { code: "dependency_unavailable" } },
        );
      }
    },
  };
}

async function changeCurrentCover(
  dependencies: {
    readonly prisma: ContentCoversPersistenceClient;
    readonly selection: ContentCoverSelection;
    readonly authorPolicy: AuthorPolicy;
  },
  command: z.infer<typeof commandSchema>,
  nextCoverId: string | null,
  sourceId: string | null,
): Promise<ChangeContentCoverResult> {
  return dependencies.prisma.$transaction(async (transaction) => {
    const handle = transactionHandle(transaction);
    if (!(await dependencies.authorPolicy.canManage(command.actor, handle))) {
      if (nextCoverId !== null)
        await abandonCover(transaction, nextCoverId, "forbidden");
      return failure("forbidden");
    }
    await lockContentCoverOwner(transaction, command.owner);
    // Imported owners change only through their own source; an import never touches other owners.
    const selected = await dependencies.selection.read(command.owner, handle);
    if (selected !== undefined && selected.sourceId !== sourceId) {
      if (nextCoverId !== null)
        await abandonCover(transaction, nextCoverId, "forbidden");
      return failure("forbidden");
    }
    const currentCoverId = selected?.coverId;
    if (currentCoverId === undefined) {
      if (nextCoverId !== null)
        await abandonCover(transaction, nextCoverId, "owner_not_found");
      return failure("owner_not_found");
    }
    if (currentCoverId !== command.expectedCoverId) {
      if (nextCoverId !== null)
        await abandonCover(transaction, nextCoverId, "conflict");
      return {
        ok: false,
        error: { code: "conflict", currentCoverId },
      };
    }
    if (nextCoverId !== null) {
      const pending = await transaction.contentCover.findUnique({
        where: { id: nextCoverId },
      });
      // An expired upload may already have been claimed by storage cleanup.
      // Never attach or revive its immutable keys after that claim commits.
      const expectedOwner = ownerColumns(command.owner);
      if (
        pending?.state !== "processing" ||
        pending.failureCode !== null ||
        !pending.uploadConfirmed ||
        pending.materialId !== expectedOwner.materialId ||
        pending.seriesId !== expectedOwner.seriesId ||
        pending.topicId !== expectedOwner.topicId
      ) {
        return dependencyUnavailable();
      }
    }
    await dependencies.selection.write(command.owner, nextCoverId, handle);
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

async function projectCover(
  transaction: ContentCoversPersistence,
  coverId: string,
): Promise<ContentCoverProjection> {
  const cover = await transaction.contentCover.findUniqueOrThrow({
    where: { id: coverId },
    include: { renditions: { orderBy: { width: "asc" } } },
  });
  return {
    coverId,
    renditions: cover.renditions.map(({ height, width }) => ({
      height,
      width,
    })),
  };
}

async function abandonCover(
  transaction: ContentCoversPersistence,
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
