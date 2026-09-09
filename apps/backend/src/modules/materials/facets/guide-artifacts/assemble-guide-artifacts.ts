import { randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  ObjectStorage,
  ObjectStorageNamespace,
} from "../../../../infrastructure/object-storage/index.js";
import type {
  MaterialsPrismaClient,
  MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import { processMaterialAssetBytes } from "../../../assets/index.js";
import { authorizeManager, type AuthorPolicy } from "../../ports/author-policy.js";
import type {
  AuthoringImportOutcome,
  GuideArtifactAccess,
  GuideArtifactAccessFacts,
  GuideArtifactContent,
  GuideArtifactDto,
  GuideArtifactError,
  GuideArtifactResult,
  GuideArtifacts,
  ReaderGuideArtifact,
  UploadedArtifactFile,
} from "./guide-artifacts.js";
import { guideArtifactAccessSchema } from "./guide-artifacts.js";

const uuidSchema = z.uuid();
const titleSchema = z.string().trim().min(1).max(200);
const purposeSchema = z.string().trim().max(1000);
const sourceIdSchema = z.string().trim().min(1).max(200);
const externalUrlSchema = z
  .url({ protocol: /^https?$/u })
  .max(2048);
const metadataSchema = z
  .object({
    access: guideArtifactAccessSchema,
    purpose: purposeSchema,
    title: titleSchema,
  })
  .strict();
const fileSchema = z
  .object({
    body: z.instanceof(Uint8Array),
    declaredContentType: z.string().min(1).max(255),
    declaredSize: z.number().int().positive(),
    expectedChecksumSha256: z.hash("sha256"),
    filename: z.string().min(1).max(255),
  })
  .strict();

const createSchema = z.discriminatedUnion("kind", [
  z
    .object({
      actor: uuidSchema,
      file: fileSchema,
      guideId: uuidSchema,
      kind: z.literal("file"),
      metadata: metadataSchema,
    })
    .strict(),
  z
    .object({
      actor: uuidSchema,
      externalUrl: externalUrlSchema,
      guideId: uuidSchema,
      kind: z.literal("link"),
      metadata: metadataSchema,
    })
    .strict(),
]);
const replaceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      actor: uuidSchema,
      artifactId: uuidSchema,
      file: fileSchema,
      kind: z.literal("file"),
    })
    .strict(),
  z
    .object({
      actor: uuidSchema,
      artifactId: uuidSchema,
      externalUrl: externalUrlSchema,
      kind: z.literal("link"),
    })
    .strict(),
]);
const updateSchema = z
  .object({
    actor: uuidSchema,
    artifactId: uuidSchema,
    metadata: metadataSchema,
  })
  .strict();
const archiveSchema = z
  .object({ actor: uuidSchema, archived: z.boolean(), artifactId: uuidSchema })
  .strict();
const guidesSchema = z
  .object({
    actor: uuidSchema,
    artifactId: uuidSchema,
    guideIds: z.array(uuidSchema).max(50),
  })
  .strict();
const materialsSchema = z
  .object({
    actor: uuidSchema,
    artifactId: uuidSchema,
    materialIds: z.array(uuidSchema).max(200),
  })
  .strict();
const removeSchema = z
  .object({ actor: uuidSchema, artifactId: uuidSchema })
  .strict();
const listSchema = z
  .object({ actor: uuidSchema, guideId: uuidSchema })
  .strict();
const importSchema = z
  .object({
    actor: uuidSchema,
    artifacts: z
      .array(
        z
          .object({
            access: guideArtifactAccessSchema,
            externalUrl: externalUrlSchema.optional(),
            file: fileSchema.optional(),
            purpose: purposeSchema,
            sourceId: sourceIdSchema,
            title: titleSchema,
          })
          .strict()
          .refine(
            (value) =>
              (value.file === undefined) !== (value.externalUrl === undefined),
            { message: "exactly one of file or externalUrl is required" },
          ),
      )
      .max(200),
    guideId: uuidSchema,
  })
  .strict();

/** The reader batch stays inside the shared ContentAccess availability limit. */
const READER_ARTIFACT_LIMIT = 100;
const AUTHORING_ARTIFACT_LIMIT = 200;
const IMPORT_ARTIFACT_LIMIT = 250;

interface StoredArtifactFile {
  readonly checksumSha256: string;
  readonly contentType: string;
  readonly filename: string;
  readonly objectNonce: string;
  readonly protectedObjectKey: string;
  readonly publicObjectKey: string;
  readonly quarantineObjectKey: string;
  readonly size: number;
}

export function assembleGuideArtifacts(dependencies: {
  readonly authorPolicy: AuthorPolicy;
  readonly objectStorage: ObjectStorage;
  readonly prisma: MaterialsPrismaClient;
}): GuideArtifacts {
  const { objectStorage, prisma } = dependencies;

  async function authorize(actor: string): Promise<GuideArtifactError | null> {
    const authorization = await authorizeManager(dependencies.authorPolicy, actor);
    return authorization.ok ? null : authorization.error;
  }

  async function storeFile(
    artifactId: string,
    file: UploadedArtifactFile,
  ): Promise<GuideArtifactResult<StoredArtifactFile>> {
    const objectNonce = randomUUID();
    const prefix = `guide-artifacts/${artifactId}/${objectNonce}`;
    const quarantineObjectKey = `${prefix}/quarantine`;
    const put = await putObject({
      body: file.body,
      checksumSha256: file.expectedChecksumSha256,
      contentType: file.declaredContentType,
      key: quarantineObjectKey,
      namespace: "quarantine",
    });
    if (!put.ok) return put;

    const processed = await processMaterialAssetBytes({
      body: file.body,
      declaredContentType: file.declaredContentType,
      declaredSize: file.declaredSize,
      expectedChecksumSha256: file.expectedChecksumSha256,
      filename: file.filename,
      kind: "file",
    });
    if (!processed.ok || processed.value.kind !== "file") {
      await forgetObject("quarantine", quarantineObjectKey);
      return {
        error: {
          code: "invalid_content",
          reason: processed.ok ? "unsupported_file_type" : processed.error.code,
        },
        ok: false,
      };
    }

    const protectedObjectKey = `${prefix}/file`;
    const publicObjectKey = `${prefix}/public-file`;
    const object = {
      body: processed.value.body,
      checksumSha256: processed.value.checksumSha256,
      contentType: processed.value.contentType,
    };
    const written = await Promise.all([
      putObject({ ...object, key: protectedObjectKey, namespace: "protected" }),
      putObject({ ...object, key: publicObjectKey, namespace: "public" }),
    ]);
    const failed = written.find((result) => !result.ok);
    if (failed !== undefined && !failed.ok) {
      await forgetObject("quarantine", quarantineObjectKey);
      return failed;
    }
    return {
      ok: true,
      value: {
        checksumSha256: processed.value.checksumSha256,
        contentType: processed.value.contentType,
        filename: file.filename,
        objectNonce,
        protectedObjectKey,
        publicObjectKey,
        quarantineObjectKey,
        size: processed.value.size,
      },
    };
  }

  async function putObject(input: {
    readonly body: Uint8Array;
    readonly checksumSha256: string;
    readonly contentType: string;
    readonly key: string;
    readonly namespace: ObjectStorageNamespace;
  }): Promise<GuideArtifactResult<null>> {
    try {
      const result = await objectStorage.putImmutable(input);
      return result.ok ? { ok: true, value: null } : dependencyUnavailable();
    } catch {
      return dependencyUnavailable();
    }
  }

  async function forgetObject(
    namespace: ObjectStorageNamespace,
    key: string,
  ): Promise<void> {
    try {
      await objectStorage.delete(namespace, key);
    } catch {
      // Quarantine and abandoned objects are immutable and unreferenced; a
      // failed cleanup never blocks the author-visible outcome.
    }
  }

  const artifacts: GuideArtifacts = {
    async create(command) {
      const parsed = createSchema.safeParse(command);
      if (!parsed.success) return failure({ code: "invalid_artifact" });
      const forbidden = await authorize(parsed.data.actor);
      if (forbidden !== null) return failure(forbidden);
      try {
        const guide = await prisma.guide.findUnique({
          select: { id: true },
          where: { id: parsed.data.guideId },
        });
        if (guide === null) return failure({ code: "guide_not_found" });
      } catch {
        return dependencyUnavailable();
      }

      const artifactId = randomUUID();
      let stored: StoredArtifactFile | null = null;
      if (parsed.data.kind === "file") {
        const file = await storeFile(artifactId, parsed.data.file);
        if (!file.ok) return file;
        stored = file.value;
      }
      try {
        await prisma.$transaction(async (transaction) => {
          await transaction.guideArtifact.create({
            data: {
              access: parsed.data.metadata.access,
              createdBy: parsed.data.actor,
              currentVersion: 1,
              id: artifactId,
              origin: "platform",
              purpose: parsed.data.metadata.purpose,
              state: "active",
              title: parsed.data.metadata.title,
            },
          });
          await transaction.guideArtifactVersion.create({
            data: versionRow({
              actor: parsed.data.actor,
              artifactId,
              stored,
              version: 1,
              ...(parsed.data.kind === "link"
                ? { externalUrl: parsed.data.externalUrl }
                : {}),
            }),
          });
          await transaction.guideArtifactPlacement.create({
            data: { artifactId, guideId: parsed.data.guideId },
          });
          await markVersionReady(transaction, artifactId, 1);
        });
      } catch {
        await forgetStoredFile(stored);
        return dependencyUnavailable();
      }
      if (stored !== null) {
        await forgetObject("quarantine", stored.quarantineObjectKey);
      }
      return projectOrFail(prisma, artifactId);
    },

    async update(command) {
      const parsed = updateSchema.safeParse(command);
      if (!parsed.success) return failure({ code: "invalid_artifact" });
      const forbidden = await authorize(parsed.data.actor);
      if (forbidden !== null) return failure(forbidden);
      try {
        const current = await prisma.guideArtifact.findUnique({
          where: { id: parsed.data.artifactId },
        });
        if (current === null) return failure({ code: "artifact_not_found" });
        await prisma.$transaction(async (transaction) => {
          const nextVersion = await reopenVersionOnAccessChange(transaction, {
            actor: parsed.data.actor,
            artifactId: current.id,
            currentAccess: current.access,
            currentVersion: current.currentVersion,
            nextAccess: parsed.data.metadata.access,
          });
          await transaction.guideArtifact.update({
            data: {
              access: parsed.data.metadata.access,
              currentVersion: nextVersion,
              purpose: parsed.data.metadata.purpose,
              title: parsed.data.metadata.title,
              updatedAt: new Date(),
            },
            where: { id: current.id },
          });
        });
      } catch {
        return dependencyUnavailable();
      }
      return projectOrFail(prisma, parsed.data.artifactId);
    },

    async replaceContent(command) {
      const parsed = replaceSchema.safeParse(command);
      if (!parsed.success) return failure({ code: "invalid_artifact" });
      const forbidden = await authorize(parsed.data.actor);
      if (forbidden !== null) return failure(forbidden);
      let currentVersion: number;
      try {
        const current = await prisma.guideArtifact.findUnique({
          select: { currentVersion: true },
          where: { id: parsed.data.artifactId },
        });
        if (current === null) return failure({ code: "artifact_not_found" });
        currentVersion = current.currentVersion;
      } catch {
        return dependencyUnavailable();
      }

      let stored: StoredArtifactFile | null = null;
      if (parsed.data.kind === "file") {
        const file = await storeFile(parsed.data.artifactId, parsed.data.file);
        if (!file.ok) return file;
        stored = file.value;
      }
      const nextVersion = currentVersion + 1;
      try {
        await prisma.$transaction(async (transaction) => {
          await transaction.guideArtifactVersion.create({
            data: versionRow({
              actor: parsed.data.actor,
              artifactId: parsed.data.artifactId,
              stored,
              version: nextVersion,
              ...(parsed.data.kind === "link"
                ? { externalUrl: parsed.data.externalUrl }
                : {}),
            }),
          });
          await markVersionReady(
            transaction,
            parsed.data.artifactId,
            nextVersion,
          );
          await supersedeVersion(
            transaction,
            parsed.data.artifactId,
            currentVersion,
          );
          await transaction.guideArtifact.update({
            data: { currentVersion: nextVersion, updatedAt: new Date() },
            where: { id: parsed.data.artifactId },
          });
        });
      } catch {
        await forgetStoredFile(stored);
        return dependencyUnavailable();
      }
      if (stored !== null) {
        await forgetObject("quarantine", stored.quarantineObjectKey);
      }
      return projectOrFail(prisma, parsed.data.artifactId);
    },

    async setArchived(command) {
      const parsed = archiveSchema.safeParse(command);
      if (!parsed.success) return failure({ code: "invalid_artifact" });
      const forbidden = await authorize(parsed.data.actor);
      if (forbidden !== null) return failure(forbidden);
      try {
        const changed = await prisma.guideArtifact.updateMany({
          data: {
            archivedAt: parsed.data.archived ? new Date() : null,
            state: parsed.data.archived ? "archived" : "active",
            updatedAt: new Date(),
          },
          where: { id: parsed.data.artifactId },
        });
        if (changed.count === 0) return failure({ code: "artifact_not_found" });
      } catch {
        return dependencyUnavailable();
      }
      return projectOrFail(prisma, parsed.data.artifactId);
    },

    async setGuides(command) {
      const parsed = guidesSchema.safeParse(command);
      if (!parsed.success) return failure({ code: "invalid_artifact" });
      const forbidden = await authorize(parsed.data.actor);
      if (forbidden !== null) return failure(forbidden);
      const guideIds = [...new Set(parsed.data.guideIds)];
      try {
        const artifact = await prisma.guideArtifact.findUnique({
          select: { id: true },
          where: { id: parsed.data.artifactId },
        });
        if (artifact === null) return failure({ code: "artifact_not_found" });
        const known = await prisma.guide.findMany({
          select: { id: true },
          where: { id: { in: guideIds } },
        });
        if (known.length !== guideIds.length) {
          return failure({ code: "guide_not_found" });
        }
        await prisma.$transaction(async (transaction) => {
          await transaction.guideArtifactPlacement.deleteMany({
            where:
              guideIds.length === 0
                ? { artifactId: parsed.data.artifactId }
                : {
                    artifactId: parsed.data.artifactId,
                    guideId: { notIn: guideIds },
                  },
          });
          await transaction.guideArtifactPlacement.createMany({
            data: guideIds.map((guideId) => ({
              artifactId: parsed.data.artifactId,
              guideId,
            })),
            skipDuplicates: true,
          });
          await transaction.guideArtifact.update({
            data: { updatedAt: new Date() },
            where: { id: parsed.data.artifactId },
          });
        });
      } catch {
        return dependencyUnavailable();
      }
      return projectOrFail(prisma, parsed.data.artifactId);
    },

    async setMaterials(command) {
      const parsed = materialsSchema.safeParse(command);
      if (!parsed.success) return failure({ code: "invalid_artifact" });
      const forbidden = await authorize(parsed.data.actor);
      if (forbidden !== null) return failure(forbidden);
      const materialIds = [...new Set(parsed.data.materialIds)];
      try {
        const artifact = await prisma.guideArtifact.findUnique({
          select: { id: true },
          where: { id: parsed.data.artifactId },
        });
        if (artifact === null) return failure({ code: "artifact_not_found" });
        const known = await prisma.material.findMany({
          select: { id: true },
          where: { id: { in: materialIds } },
        });
        if (known.length !== materialIds.length) {
          return failure({ code: "material_not_found" });
        }
        await prisma.$transaction(async (transaction) => {
          await transaction.guideArtifactMaterialLink.deleteMany({
            where:
              materialIds.length === 0
                ? { artifactId: parsed.data.artifactId }
                : {
                    artifactId: parsed.data.artifactId,
                    materialId: { notIn: materialIds },
                  },
          });
          await transaction.guideArtifactMaterialLink.createMany({
            data: materialIds.map((materialId) => ({
              artifactId: parsed.data.artifactId,
              materialId,
            })),
            skipDuplicates: true,
          });
          await transaction.guideArtifact.update({
            data: { updatedAt: new Date() },
            where: { id: parsed.data.artifactId },
          });
        });
      } catch {
        return dependencyUnavailable();
      }
      return projectOrFail(prisma, parsed.data.artifactId);
    },

    async remove(command) {
      const parsed = removeSchema.safeParse(command);
      if (!parsed.success) return failure({ code: "invalid_artifact" });
      const forbidden = await authorize(parsed.data.actor);
      if (forbidden !== null) return failure(forbidden);
      try {
        const artifact = await prisma.guideArtifact.findUnique({
          include: { materialLinks: true, placements: true },
          where: { id: parsed.data.artifactId },
        });
        if (artifact === null) return failure({ code: "artifact_not_found" });
        if (
          artifact.placements.length > 0 ||
          artifact.materialLinks.length > 0
        ) {
          return failure({
            code: "artifact_referenced",
            guideIds: artifact.placements.map(({ guideId }) => guideId),
          });
        }
        await prisma.guideArtifact.delete({
          where: { id: parsed.data.artifactId },
        });
      } catch {
        return dependencyUnavailable();
      }
      return { ok: true, value: { artifactId: parsed.data.artifactId } };
    },

    async listForGuide(query) {
      const parsed = listSchema.safeParse(query);
      if (!parsed.success) return failure({ code: "invalid_artifact" });
      const forbidden = await authorize(parsed.data.actor);
      if (forbidden !== null) return failure(forbidden);
      try {
        const guide = await prisma.guide.findUnique({
          select: { id: true },
          where: { id: parsed.data.guideId },
        });
        if (guide === null) return failure({ code: "guide_not_found" });
        const rows = await loadPlacedArtifacts(prisma, parsed.data.guideId, {
          take: AUTHORING_ARTIFACT_LIMIT,
        });
        return {
          ok: true,
          value: rows.flatMap((row) => {
            const projected = projectRow(row);
            return projected === null ? [] : [projected];
          }),
        };
      } catch {
        return dependencyUnavailable();
      }
    },

    async listReusable(query) {
      const parsed = z
        .object({ actor: uuidSchema })
        .strict()
        .safeParse(query);
      if (!parsed.success) return failure({ code: "invalid_artifact" });
      const forbidden = await authorize(parsed.data.actor);
      if (forbidden !== null) return failure(forbidden);
      try {
        const rows = await prisma.guideArtifact.findMany({
          include: {
            materialLinks: { orderBy: { materialId: "asc" } },
            placements: { orderBy: { createdAt: "asc" } },
            versions: true,
          },
          orderBy: { updatedAt: "desc" },
          take: AUTHORING_ARTIFACT_LIMIT,
          where: { state: "active" },
        });
        return {
          ok: true,
          value: rows.flatMap((row) => {
            const projected = projectRow(row);
            return projected === null ? [] : [projected];
          }),
        };
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadForReader(guideId) {
      const parsedGuideId = uuidSchema.safeParse(guideId);
      if (!parsedGuideId.success) return failure({ code: "guide_not_found" });
      try {
        const guide = await prisma.guide.findUnique({
          select: { id: true },
          where: { id: parsedGuideId.data },
        });
        if (guide === null) return failure({ code: "guide_not_found" });
        const rows = await loadPlacedArtifacts(prisma, parsedGuideId.data, {
          state: "active",
          take: READER_ARTIFACT_LIMIT,
        });
        return {
          ok: true,
          value: rows.flatMap((row): readonly ReaderGuideArtifact[] => {
            const content = currentContent(row);
            return content === null
              ? []
              : [
                  {
                    artifactId: row.id,
                    content,
                    purpose: row.purpose,
                    title: row.title,
                    updatedAt: row.updatedAt.toISOString(),
                    version: row.currentVersion,
                  },
                ];
          }),
        };
      } catch {
        return dependencyUnavailable();
      }
    },

    async loadFileDelivery(input) {
      const parsedArtifactId = uuidSchema.safeParse(input.artifactId);
      const parsedGuideId = uuidSchema.safeParse(input.guideId);
      if (!parsedArtifactId.success || !parsedGuideId.success) {
        return { ok: true, value: null };
      }
      try {
        const placement = await prisma.guideArtifactPlacement.findUnique({
          where: {
            artifactId_guideId: {
              artifactId: parsedArtifactId.data,
              guideId: parsedGuideId.data,
            },
          },
        });
        if (placement === null) return { ok: true, value: null };
        const row = await loadArtifactRow(prisma, parsedArtifactId.data);
        const current = row === null ? null : readyVersion(row);
        if (
          current === null ||
          current.contentKind !== "file" ||
          current.protectedObjectKey === null ||
          current.contentType === null ||
          current.byteSize === null ||
          current.originalFilename === null
        ) {
          return { ok: true, value: null };
        }
        return {
          ok: true,
          value: {
            artifactId: parsedArtifactId.data,
            contentType: current.contentType,
            filename: current.originalFilename,
            object: {
              protectedKey: current.protectedObjectKey,
              publicKey: current.publicObjectKey,
            },
            size: current.byteSize,
          },
        };
      } catch {
        return dependencyUnavailable();
      }
    },

    async applyAuthoringImport(input) {
      const parsed = importSchema.safeParse(input);
      if (!parsed.success) return failure({ code: "invalid_artifact" });
      const command = parsed.data;
      const forbidden = await authorize(command.actor);
      if (forbidden !== null) return failure(forbidden);
      const sourceIds = command.artifacts.map(({ sourceId }) => sourceId);
      if (new Set(sourceIds).size !== sourceIds.length) {
        return failure({ code: "source_conflict" });
      }
      let placed: Awaited<ReturnType<typeof loadPlacedArtifacts>>;
      try {
        const guide = await prisma.guide.findUnique({
          select: { id: true },
          where: { id: command.guideId },
        });
        if (guide === null) return failure({ code: "guide_not_found" });
        placed = await loadPlacedArtifacts(prisma, command.guideId, {
          take: IMPORT_ARTIFACT_LIMIT,
        });
      } catch {
        return dependencyUnavailable();
      }
      // Records authored on Platform stay outside every import decision: an
      // import never matches, changes or archives them.
      const authored = placed.filter(({ origin }) => origin === "authoring");
      const outcomes: AuthoringImportOutcome[] = [];
      for (const source of command.artifacts) {
        const outcome = await importOne(source, authored);
        if (!outcome.ok) return outcome;
        outcomes.push(outcome.value);
      }
      for (const existing of authored) {
        if (!sourceIds.includes(existing.sourceId ?? "")) {
          outcomes.push({
            artifactId: existing.id,
            outcome: "missing",
            sourceId: existing.sourceId,
            title: existing.title,
          });
        }
      }
      return { ok: true, value: { outcomes } };

      async function importOne(
        source: z.infer<typeof importSchema>["artifacts"][number],
        existingArtifacts: typeof placed,
      ): Promise<GuideArtifactResult<AuthoringImportOutcome>> {
        const existing =
          existingArtifacts.find(({ sourceId }) => sourceId === source.sourceId) ??
          null;
        if (existing === null) {
          return createFromSource(source);
        }
        if (existing.currentVersion !== existing.importedVersion) {
          return {
            ok: true,
            value: {
              artifactId: existing.id,
              outcome: "diverged",
              sourceId: source.sourceId,
              title: existing.title,
            },
          };
        }
        const current = readyVersion(existing);
        const sameContent =
          current !== null &&
          (source.file === undefined
            ? current.contentKind === "link" &&
              current.externalUrl === source.externalUrl
            : current.contentKind === "file" &&
              current.checksumSha256 === source.file.expectedChecksumSha256);
        if (
          sameContent &&
          existing.title === source.title &&
          existing.purpose === source.purpose &&
          existing.access === source.access
        ) {
          return {
            ok: true,
            value: {
              artifactId: existing.id,
              outcome: "unchanged",
              sourceId: source.sourceId,
              title: existing.title,
            },
          };
        }
        return updateFromSource(existing, source, sameContent);
      }

      async function createFromSource(
        source: z.infer<typeof importSchema>["artifacts"][number],
      ): Promise<GuideArtifactResult<AuthoringImportOutcome>> {
        const artifactId = randomUUID();
        let stored: StoredArtifactFile | null = null;
        if (source.file !== undefined) {
          const file = await storeFile(artifactId, source.file);
          if (!file.ok) return file;
          stored = file.value;
        }
        try {
          await prisma.$transaction(async (transaction) => {
            await transaction.guideArtifact.create({
              data: {
                access: source.access,
                createdBy: command.actor,
                currentVersion: 1,
                id: artifactId,
                importedAt: new Date(),
                importedVersion: 1,
                origin: "authoring",
                purpose: source.purpose,
                sourceId: source.sourceId,
                state: "active",
                title: source.title,
              },
            });
            await transaction.guideArtifactVersion.create({
              data: versionRow({
                actor: command.actor,
                artifactId,
                stored,
                version: 1,
                ...(source.externalUrl === undefined
                  ? {}
                  : { externalUrl: source.externalUrl }),
              }),
            });
            await transaction.guideArtifactPlacement.create({
              data: { artifactId, guideId: command.guideId },
            });
            await markVersionReady(transaction, artifactId, 1);
          });
        } catch {
          await forgetStoredFile(stored);
          return dependencyUnavailable();
        }
        if (stored !== null) {
          await forgetObject("quarantine", stored.quarantineObjectKey);
        }
        return {
          ok: true,
          value: {
            artifactId,
            outcome: "created",
            sourceId: source.sourceId,
            title: source.title,
          },
        };
      }

      async function updateFromSource(
        existing: (typeof placed)[number],
        source: z.infer<typeof importSchema>["artifacts"][number],
        sameContent: boolean,
      ): Promise<GuideArtifactResult<AuthoringImportOutcome>> {
        let stored: StoredArtifactFile | null = null;
        if (!sameContent && source.file !== undefined) {
          const file = await storeFile(existing.id, source.file);
          if (!file.ok) return file;
          stored = file.value;
        }
        try {
          await prisma.$transaction(async (transaction) => {
            let nextVersion = existing.currentVersion;
            if (sameContent) {
              nextVersion = await reopenVersionOnAccessChange(transaction, {
                actor: command.actor,
                artifactId: existing.id,
                currentAccess: existing.access,
                currentVersion: existing.currentVersion,
                nextAccess: source.access,
              });
            } else {
              nextVersion = existing.currentVersion + 1;
              await transaction.guideArtifactVersion.create({
                data: versionRow({
                  actor: command.actor,
                  artifactId: existing.id,
                  stored,
                  version: nextVersion,
                  ...(source.externalUrl === undefined
                    ? {}
                    : { externalUrl: source.externalUrl }),
                }),
              });
              await markVersionReady(transaction, existing.id, nextVersion);
              await supersedeVersion(
                transaction,
                existing.id,
                existing.currentVersion,
              );
            }
            await transaction.guideArtifact.update({
              data: {
                access: source.access,
                currentVersion: nextVersion,
                importedAt: new Date(),
                importedVersion: nextVersion,
                purpose: source.purpose,
                title: source.title,
                updatedAt: new Date(),
              },
              where: { id: existing.id },
            });
          });
        } catch {
          await forgetStoredFile(stored);
          return dependencyUnavailable();
        }
        if (stored !== null) {
          await forgetObject("quarantine", stored.quarantineObjectKey);
        }
        return {
          ok: true,
          value: {
            artifactId: existing.id,
            outcome: "updated",
            sourceId: source.sourceId,
            title: source.title,
          },
        };
      }
    },

    async loadAccessFacts(artifactIds) {
      const ids = artifactIds.filter((value) => uuidSchema.safeParse(value).success);
      if (ids.length === 0) return [];
      const rows = await prisma.guideArtifact.findMany({
        include: { placements: { select: { guideId: true } } },
        where: { id: { in: ids } },
      });
      return rows.map(
        (row): GuideArtifactAccessFacts => ({
          access: readAccess(row.access),
          archived: row.state === "archived",
          artifactId: row.id,
          guideIds: row.placements.map(({ guideId }) => guideId),
          version: row.currentVersion,
        }),
      );
    },
  };

  async function forgetStoredFile(stored: StoredArtifactFile | null): Promise<void> {
    if (stored === null) return;
    await Promise.all([
      forgetObject("quarantine", stored.quarantineObjectKey),
      forgetObject("protected", stored.protectedObjectKey),
      forgetObject("public", stored.publicObjectKey),
    ]);
  }

  return Object.freeze(artifacts);
}

type ArtifactRow = NonNullable<Awaited<ReturnType<typeof loadArtifactRow>>>;

async function loadArtifactRow(
  prisma: MaterialsPrismaClient,
  artifactId: string,
) {
  return prisma.guideArtifact.findUnique({
    include: {
      materialLinks: { orderBy: { materialId: "asc" } },
      placements: { orderBy: { createdAt: "asc" } },
      versions: true,
    },
    where: { id: artifactId },
  });
}

async function loadPlacedArtifacts(
  prisma: MaterialsPrismaClient,
  guideId: string,
  options: { readonly state?: "active"; readonly take: number },
): Promise<readonly ArtifactRow[]> {
  return prisma.guideArtifact.findMany({
    include: {
      materialLinks: { orderBy: { materialId: "asc" } },
      placements: { orderBy: { createdAt: "asc" } },
      versions: true,
    },
    orderBy: { createdAt: "asc" },
    take: options.take,
    where: {
      placements: { some: { guideId } },
      ...(options.state === undefined ? {} : { state: options.state }),
    },
  });
}

function projectRow(row: ArtifactRow): GuideArtifactDto | null {
  const content = currentContent(row);
  if (content === null) return null;
  return {
    access: readAccess(row.access),
    archived: row.state === "archived",
    artifactId: row.id,
    content,
    guideIds: row.placements.map(({ guideId }) => guideId),
    materialIds: row.materialLinks.map(({ materialId }) => materialId),
    origin: row.origin === "authoring" ? "authoring" : "platform",
    purpose: row.purpose,
    sourceId: row.sourceId,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    version: row.currentVersion,
  };
}

function readyVersion(row: ArtifactRow): ArtifactRow["versions"][number] | null {
  return (
    row.versions.find(
      (version) =>
        version.version === row.currentVersion && version.state === "ready",
    ) ?? null
  );
}

function currentContent(row: ArtifactRow): GuideArtifactContent | null {
  const current = readyVersion(row);
  if (current === null) return null;
  if (current.contentKind === "link") {
    return current.externalUrl === null
      ? null
      : { externalUrl: current.externalUrl, kind: "link" };
  }
  return current.contentType === null ||
    current.byteSize === null ||
    current.originalFilename === null
    ? null
    : {
        contentType: current.contentType,
        filename: current.originalFilename,
        kind: "file",
        size: current.byteSize,
      };
}

async function projectArtifact(
  prisma: MaterialsPrismaClient,
  artifactId: string,
): Promise<GuideArtifactDto | null> {
  const row = await loadArtifactRow(prisma, artifactId);
  return row === null ? null : projectRow(row);
}

async function projectOrFail(
  prisma: MaterialsPrismaClient,
  artifactId: string,
): Promise<GuideArtifactResult<GuideArtifactDto>> {
  try {
    const projected = await projectArtifact(prisma, artifactId);
    return projected === null
      ? failure({ code: "artifact_not_found" })
      : { ok: true, value: projected };
  } catch {
    return dependencyUnavailable();
  }
}

function versionRow(input: {
  readonly actor: string;
  readonly artifactId: string;
  readonly externalUrl?: string;
  readonly stored: StoredArtifactFile | null;
  readonly version: number;
}) {
  const { actor, artifactId, externalUrl, stored, version } = input;
  if (stored === null) {
    return {
      artifactId,
      contentKind: "link",
      createdBy: actor,
      externalUrl: externalUrl ?? null,
      state: "processing",
      version,
    };
  }
  return {
    artifactId,
    byteSize: stored.size,
    checksumSha256: stored.checksumSha256,
    contentKind: "file",
    contentType: stored.contentType,
    createdBy: actor,
    objectNonce: stored.objectNonce,
    originalFilename: stored.filename,
    protectedObjectKey: stored.protectedObjectKey,
    publicObjectKey: stored.publicObjectKey,
    quarantineObjectKey: stored.quarantineObjectKey,
    state: "processing",
    version,
  };
}

/**
 * An access change alters who may download the current bytes, so it opens a new
 * delivery version over the same stored content instead of leaving a cached
 * address valid under the previous access class.
 */
async function reopenVersionOnAccessChange(
  transaction: MaterialsPrismaTransaction,
  input: {
    readonly actor: string;
    readonly artifactId: string;
    readonly currentAccess: string;
    readonly currentVersion: number;
    readonly nextAccess: GuideArtifactAccess;
  },
): Promise<number> {
  if (input.currentAccess === input.nextAccess) return input.currentVersion;
  const nextVersion = input.currentVersion + 1;
  const source = await transaction.guideArtifactVersion.findUniqueOrThrow({
    where: {
      artifactId_version: {
        artifactId: input.artifactId,
        version: input.currentVersion,
      },
    },
  });
  await transaction.guideArtifactVersion.create({
    data: {
      artifactId: input.artifactId,
      byteSize: source.byteSize,
      checksumSha256: source.checksumSha256,
      contentKind: source.contentKind,
      contentType: source.contentType,
      createdBy: input.actor,
      externalUrl: source.externalUrl,
      objectNonce: source.objectNonce,
      originalFilename: source.originalFilename,
      protectedObjectKey: source.protectedObjectKey,
      publicObjectKey: source.publicObjectKey,
      quarantineObjectKey: source.quarantineObjectKey,
      readyAt: new Date(),
      state: "ready",
      version: nextVersion,
    },
  });
  await supersedeVersion(transaction, input.artifactId, input.currentVersion);
  return nextVersion;
}

async function markVersionReady(
  transaction: MaterialsPrismaTransaction,
  artifactId: string,
  version: number,
): Promise<void> {
  await transaction.guideArtifactVersion.update({
    data: { readyAt: new Date(), state: "ready" },
    where: { artifactId_version: { artifactId, version } },
  });
}

async function supersedeVersion(
  transaction: MaterialsPrismaTransaction,
  artifactId: string,
  version: number,
): Promise<void> {
  await transaction.guideArtifactVersion.updateMany({
    data: { supersededAt: new Date() },
    where: { artifactId, supersededAt: null, version },
  });
}

function readAccess(value: string): GuideArtifactAccess {
  return value === "membership" ? "membership" : "free";
}

function failure<Value>(error: GuideArtifactError): GuideArtifactResult<Value> {
  return { error, ok: false };
}

function dependencyUnavailable<Value>(): GuideArtifactResult<Value> {
  return { error: { code: "dependency_unavailable", retryable: true }, ok: false };
}
