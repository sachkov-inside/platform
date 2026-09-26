import type {
  MaterialsPrismaClient,
  MaterialsPrismaTransaction,
} from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type {
  GuideArtifactFiles,
  StoredArtifactFile,
} from "./guide-artifact-files.js";
import type {
  GuideArtifactAccess,
  GuideArtifactContent,
  GuideArtifactDto,
  GuideArtifactError,
  GuideArtifactResult,
} from "./guide-artifacts.js";

/** What every Guide Artifact operation works with. */
export interface GuideArtifactContext {
  /** Null when the actor may manage artifacts, otherwise the refusal. */
  readonly authorize: (actor: string) => Promise<GuideArtifactError | null>;
  readonly files: GuideArtifactFiles;
  readonly prisma: MaterialsPrismaClient;
}

export type ArtifactRow = NonNullable<
  Awaited<ReturnType<typeof loadArtifactRow>>
>;

export async function loadArtifactRow(
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

export async function loadArtifactsBySource(
  prisma: MaterialsPrismaClient,
  sourceIds: readonly string[],
): Promise<readonly ArtifactRow[]> {
  return prisma.guideArtifact.findMany({
    include: {
      materialLinks: { orderBy: { materialId: "asc" } },
      placements: { orderBy: { createdAt: "asc" } },
      versions: true,
    },
    where: { origin: "authoring", sourceId: { in: [...sourceIds] } },
  });
}

export async function loadPlacedArtifacts(
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

export function projectRow(row: ArtifactRow): GuideArtifactDto | null {
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

/** The stored content the reader may currently receive. */
export function readyVersion(
  row: ArtifactRow,
): ArtifactRow["versions"][number] | null {
  return (
    row.versions.find((version) => version.version === row.currentVersion) ??
    null
  );
}

export function currentContent(row: ArtifactRow): GuideArtifactContent | null {
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

export async function projectOrFail(
  prisma: MaterialsPrismaClient,
  artifactId: string,
): Promise<GuideArtifactResult<GuideArtifactDto>> {
  try {
    const projected = await projectArtifact(prisma, artifactId);
    return projected === null
      ? failure({ code: "artifact_not_found" })
      : { ok: true, value: projected };
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "projectOrFail" },
      error,
      dependencyUnavailable(),
    );
  }
}

export function versionRow(input: {
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
    version,
  };
}

/**
 * An access change alters who may download the current bytes, so it opens a new
 * delivery version over the same stored content instead of leaving a cached
 * address valid under the previous access class.
 */
export async function reopenVersionOnAccessChange(
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
      version: nextVersion,
    },
  });
  await supersedeVersion(transaction, input.artifactId, input.currentVersion);
  return nextVersion;
}

export async function supersedeVersion(
  transaction: MaterialsPrismaTransaction,
  artifactId: string,
  version: number,
): Promise<void> {
  await transaction.guideArtifactVersion.updateMany({
    data: { supersededAt: new Date() },
    where: { artifactId, supersededAt: null, version },
  });
}

// The database constrains this column to two values; an unexpected one stays
// closed rather than opening protected content to everyone.
export function readAccess(value: string): GuideArtifactAccess {
  return value === "free" ? "free" : "membership";
}

export function failure<Value>(
  error: GuideArtifactError,
): GuideArtifactResult<Value> {
  return { error, ok: false };
}

export function dependencyUnavailable<Value>(): GuideArtifactResult<Value> {
  return {
    error: { code: "dependency_unavailable", retryable: true },
    ok: false,
  };
}
