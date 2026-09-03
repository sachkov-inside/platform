import { createHash } from "node:crypto";

import { z } from "zod";

import { accountId } from "../../../accounts/index.js";
import { lockMaterialReferenceChanges } from "../../../../infrastructure/prisma/index.js";
import type { WorkshopPrismaClient } from "../../infrastructure/prisma.js";
import type { SourceArchives, StoredSourceArchive } from "../../ports/source-archives.js";
import type { WorkshopMaterialCatalog } from "../../ports/workshop-material-catalog.js";
import type { WorkshopOwnerPolicy } from "../../ports/workshop-owner-policy.js";
import {
  workshopCaseSlugSchema,
  workshopIdempotencyKeySchema,
  workshopScopeSchema,
} from "../../shared/workshop-validation.js";
import type {
  PublishWorkshopCaseCommand,
  PublishedWorkshopCaseDto,
  PublishWorkshopCaseResult,
} from "../../facets/workshop/workshop.interface.js";

const releasePolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("immediate") }).strict(),
  z
    .object({
      kind: z.literal("hint_reveal"),
      hintKey: z.string().trim().min(1).max(128),
    })
    .strict(),
  z.object({ kind: z.literal("solution_reveal") }).strict(),
]);
const materialSchema = z
  .object({
    materialId: z.uuid(),
    role: z.enum([
      "prerequisite",
      "optional_reference",
      "hint",
      "exact_solution",
      "walkthrough",
      "alternatives",
    ]),
    ordinal: z.number().int().positive(),
    releasePolicy: releasePolicySchema,
  })
  .strict()
  .superRefine(({ role, releasePolicy }, context) => {
    const matches =
      ((role === "prerequisite" || role === "optional_reference") &&
        releasePolicy.kind === "immediate") ||
      (role === "hint" && releasePolicy.kind === "hint_reveal") ||
      ((role === "exact_solution" ||
        role === "walkthrough" ||
        role === "alternatives") &&
        releasePolicy.kind === "solution_reveal");
    if (!matches) context.addIssue({ code: "custom", path: ["releasePolicy"], message: "Release policy does not match Material role" });
  });
const commandSchema = z
  .object({
    actorAccountId: z.uuid(),
    caseSlug: workshopCaseSlugSchema,
    workshopScope: workshopScopeSchema,
    caseVersion: z.string().trim().min(1).max(128),
    schemaVersion: z.string().trim().min(1).max(128),
    sourceRepository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u).max(256),
    sourceCommit: z.hash("sha1"),
    caseSpec: z.record(z.string(), z.json()),
    contentDigest: z.hash("sha256"),
    artifacts: z
      .array(
        z
          .object({
            name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(128),
            body: z.instanceof(Uint8Array),
            contentType: z.string().trim().min(1).max(255),
            retentionTime: z.iso.datetime({ offset: true }),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    materials: z.array(materialSchema).min(1).max(100),
    idempotencyKey: workshopIdempotencyKeySchema,
  })
  .strict();

const MAX_CASE_SPEC_BYTES = 1024 * 1024;

export async function publishWorkshopCase(
  dependencies: {
    readonly prisma: WorkshopPrismaClient;
    readonly ownerPolicy: WorkshopOwnerPolicy;
    readonly materialCatalog: WorkshopMaterialCatalog;
    readonly sourceArchives: SourceArchives;
    readonly clock: () => Date;
    readonly id: () => string;
  },
  command: PublishWorkshopCaseCommand,
): Promise<PublishWorkshopCaseResult> {
  const parsed = commandSchema.safeParse(command);
  if (!parsed.success) return failure("invalid_request");
  const canonicalCaseSpec = canonicalJson(parsed.data.caseSpec);
  if (
    Buffer.byteLength(canonicalCaseSpec, "utf8") > MAX_CASE_SPEC_BYTES ||
    sha256(canonicalCaseSpec) !== parsed.data.contentDigest
  ) {
    return failure("invalid_case_spec");
  }
  if (
    new Set(parsed.data.materials.map(({ materialId }) => materialId)).size !==
      parsed.data.materials.length ||
    new Set(parsed.data.materials.map(({ ordinal }) => ordinal)).size !==
      parsed.data.materials.length ||
    new Set(parsed.data.artifacts.map(({ name }) => name)).size !==
      parsed.data.artifacts.length
  ) {
    return failure("invalid_request");
  }

  try {
    if (
      !(await dependencies.ownerPolicy.canManageWorkshop(
        accountId(parsed.data.actorAccountId),
      ))
    ) {
      return failure("forbidden");
    }
    const artifactInputs = parsed.data.artifacts.map((artifact) => ({
      ...artifact,
      digest: sha256(artifact.body),
    }));
    const fingerprint = publicationFingerprint(parsed.data, artifactInputs);
    const replay = await findPublicationReplay(dependencies.prisma, parsed.data, fingerprint);
    if (replay !== undefined) return replay;

    const requestedMaterialIds = parsed.data.materials.map(
      ({ materialId }) => materialId,
    );
    if (
      !(await workshopMaterialsAreValid(
        dependencies.materialCatalog,
        requestedMaterialIds,
      ))
    ) {
      return failure("invalid_material");
    }

    const artifacts: StoredSourceArchive[] = [];
    for (const artifact of artifactInputs) {
      const stored = await dependencies.sourceArchives.store(artifact);
      if (!stored.ok || stored.value.digest !== artifact.digest) {
        return failure("artifact_unavailable");
      }
      artifacts.push(stored.value);
    }

    const publishedAt = dependencies.clock();
    try {
      return await dependencies.prisma.$transaction(async (transaction) => {
        const concurrentReplay = await findPublicationReplay(
          transaction,
          parsed.data,
          fingerprint,
        );
        if (concurrentReplay !== undefined) return concurrentReplay;
        await lockMaterialReferenceChanges(transaction, requestedMaterialIds);
        if (
          !(await workshopMaterialsAreValid(
            dependencies.materialCatalog,
            requestedMaterialIds,
          ))
        ) {
          return failure("invalid_material");
        }

        let workshopCase = await transaction.workshopCase.findUnique({
          where: { slug: parsed.data.caseSlug },
        });
        if (
          workshopCase !== null &&
          (workshopCase.workshopScope !== parsed.data.workshopScope ||
            workshopCase.lifecycle === "retired")
        ) {
          return failure("publication_conflict");
        }
        workshopCase ??= await transaction.workshopCase.create({
          data: {
            id: dependencies.id(),
            slug: parsed.data.caseSlug,
            workshopScope: parsed.data.workshopScope,
            lifecycle: "draft",
            createdAt: publishedAt,
            updatedAt: publishedAt,
          },
        });
        const version = await transaction.workshopCaseVersion.create({
          data: {
            id: dependencies.id(),
            caseId: workshopCase.id,
            caseVersion: parsed.data.caseVersion,
            schemaVersion: parsed.data.schemaVersion,
            caseSpec: parsed.data.caseSpec,
            contentDigest: parsed.data.contentDigest,
            sourceRepository: parsed.data.sourceRepository,
            sourceCommit: parsed.data.sourceCommit,
            artifacts: artifacts.map((artifact) => ({ ...artifact })),
            publicationFingerprint: fingerprint,
            publishedBy: parsed.data.actorAccountId,
            idempotencyKey: parsed.data.idempotencyKey,
            publishedAt,
          },
        });
        await transaction.workshopCaseMaterial.createMany({
          data: parsed.data.materials.map(({ releasePolicy, ...material }) => ({
            ...material,
            caseVersionId: version.id,
            releasePolicy: releasePolicy.kind,
            hintKey:
              releasePolicy.kind === "hint_reveal"
                ? releasePolicy.hintKey
                : null,
          })),
        });
        await transaction.workshopCase.update({
          where: { id: workshopCase.id },
          data: {
            currentVersionId: version.id,
            lifecycle: "published",
            updatedAt: publishedAt,
          },
        });
        return success(workshopCase.id, parsed.data.caseSlug, version);
      });
    } catch {
      return await findPublicationReplay(
        dependencies.prisma,
        parsed.data,
        fingerprint,
      ) ?? failure("dependency_unavailable");
    }
  } catch {
    return failure("dependency_unavailable");
  }
}

async function workshopMaterialsAreValid(
  materialCatalog: WorkshopMaterialCatalog,
  materialIds: readonly string[],
): Promise<boolean> {
  const materialFacts = await materialCatalog.findMany(materialIds);
  const requestedMaterialIds = new Set(materialIds);
  const materialFactIds = new Set(
    materialFacts.map(({ materialId }) => materialId),
  );
  return materialFacts.length === materialIds.length &&
    materialFactIds.size === requestedMaterialIds.size &&
    materialFacts.every(
      ({ access, materialId, publicationState }) =>
        requestedMaterialIds.has(materialId) &&
        access === "workshop" &&
        publicationState === "published",
    );
}

async function findPublicationReplay(
  prisma: Pick<WorkshopPrismaClient, "workshopCaseVersion">,
  command: z.infer<typeof commandSchema>,
  fingerprint: string,
): Promise<PublishWorkshopCaseResult | undefined> {
  const byKey = await prisma.workshopCaseVersion.findUnique({
    where: {
      publishedBy_idempotencyKey: {
        publishedBy: command.actorAccountId,
        idempotencyKey: command.idempotencyKey,
      },
    },
    include: { workshopCase: { select: { slug: true } } },
  });
  if (byKey !== null) {
    return byKey.publicationFingerprint === fingerprint
      ? success(byKey.caseId, byKey.workshopCase.slug, byKey)
      : failure("idempotency_key_reused");
  }
  const bySource = await prisma.workshopCaseVersion.findUnique({
    where: {
      sourceRepository_sourceCommit_contentDigest: {
        sourceRepository: command.sourceRepository,
        sourceCommit: command.sourceCommit,
        contentDigest: command.contentDigest,
      },
    },
    include: { workshopCase: { select: { slug: true } } },
  });
  if (bySource === null) return undefined;
  return bySource.publicationFingerprint === fingerprint
    ? success(bySource.caseId, bySource.workshopCase.slug, bySource)
    : failure("publication_conflict");
}

function publicationFingerprint(
  command: z.infer<typeof commandSchema>,
  artifacts: readonly { readonly digest: string; readonly name: string }[],
): string {
  return sha256(
    canonicalJson({
      artifacts: artifacts.map(({ digest, name }) => ({ digest, name })),
      caseSlug: command.caseSlug,
      caseVersion: command.caseVersion,
      contentDigest: command.contentDigest,
      materials: command.materials,
      schemaVersion: command.schemaVersion,
      sourceCommit: command.sourceCommit,
      sourceRepository: command.sourceRepository,
      workshopScope: command.workshopScope,
    }),
  );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function success(
  caseId: string,
  caseSlug: string,
  version: {
    readonly id: string;
    readonly caseVersion: string;
    readonly contentDigest: string;
    readonly publishedAt: Date;
  },
): Extract<PublishWorkshopCaseResult, { readonly ok: true }> {
  const value: PublishedWorkshopCaseDto = {
    caseId,
    caseSlug,
    caseVersionId: version.id,
    caseVersion: version.caseVersion,
    contentDigest: version.contentDigest,
    publishedAt: version.publishedAt.toISOString(),
  };
  return { ok: true, value };
}

function failure(
  code: Extract<PublishWorkshopCaseResult, { readonly ok: false }>["error"]["code"],
): Extract<PublishWorkshopCaseResult, { readonly ok: false }> {
  return { ok: false, error: { code } };
}
