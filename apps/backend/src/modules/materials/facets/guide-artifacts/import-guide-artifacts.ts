import { randomUUID } from "node:crypto";

import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import {
  IMPORT_ARTIFACT_LIMIT,
  importSchema,
  type AuthoringImportCommand,
  type ImportedArtifactSource,
} from "./guide-artifact-commands.js";
import type { StoredArtifactFile } from "./guide-artifact-files.js";
import {
  dependencyUnavailable,
  failure,
  loadArtifactsBySource,
  loadPlacedArtifacts,
  readyVersion,
  reopenVersionOnAccessChange,
  supersedeVersion,
  versionRow,
  type ArtifactRow,
  type GuideArtifactContext,
} from "./guide-artifact-records.js";
import type {
  ApplyAuthoringImportCommand,
  AuthoringImportOutcome,
  AuthoringImportReport,
  GuideArtifactResult,
} from "./guide-artifacts.js";

/** One editor change landed while the import was deciding against an older revision. */
class ConcurrentArtifactChange extends Error {}

/**
 * Applies the artifacts of one authoring package to its Guide. Each source artifact is created,
 * updated, left unchanged or reported as diverged; an authoring artifact the package no longer
 * names is reported as missing. Artifacts authored on Platform stay outside every decision.
 */
export async function applyAuthoringImport(
  context: GuideArtifactContext,
  input: ApplyAuthoringImportCommand,
): Promise<GuideArtifactResult<AuthoringImportReport>> {
  const parsed = importSchema.safeParse(input);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const command = parsed.data;
  const forbidden = await context.authorize(command.actor);
  if (forbidden !== null) return failure(forbidden);
  const sourceIds = command.artifacts.map(({ sourceId }) => sourceId);
  if (new Set(sourceIds).size !== sourceIds.length) {
    return failure({ code: "source_conflict" });
  }
  const known = await loadImportCandidates(context, command, sourceIds);
  if (!known.ok) return known;
  const outcomes: AuthoringImportOutcome[] = [];
  for (const source of command.artifacts) {
    const outcome = await importSource(
      context,
      command,
      source,
      known.value.candidates,
    );
    if (!outcome.ok) return outcome;
    outcomes.push(outcome.value);
  }
  outcomes.push(...missingArtifacts(known.value.authored, sourceIds));
  return { ok: true, value: { outcomes } };
}

/**
 * The authoring artifacts the import may match: those already placed in the Guide and those
 * the package names by source, which may live in another Guide.
 */
async function loadImportCandidates(
  context: GuideArtifactContext,
  command: AuthoringImportCommand,
  sourceIds: readonly string[],
): Promise<
  GuideArtifactResult<{
    readonly authored: readonly ArtifactRow[];
    readonly candidates: readonly ArtifactRow[];
  }>
> {
  const { prisma } = context;
  let placed: readonly ArtifactRow[];
  let namedBySource: readonly ArtifactRow[];
  try {
    const guide = await prisma.guide.findUnique({
      select: { id: true, sourceId: true },
      where: { id: command.guideId },
    });
    if (guide === null) return failure({ code: "guide_not_found" });
    if (
      command.guideSourceId !== undefined &&
      guide.sourceId !== command.guideSourceId
    ) {
      return failure({ code: "forbidden" });
    }
    placed = await loadPlacedArtifacts(prisma, command.guideId, {
      take: IMPORT_ARTIFACT_LIMIT,
    });
    // An artifact the authoring base already owns may live in another
    // Guide; the package reuses that record instead of creating a second.
    namedBySource =
      sourceIds.length === 0
        ? []
        : await loadArtifactsBySource(prisma, sourceIds);
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "applyAuthoringImport" },
      error,
      dependencyUnavailable(),
    );
  }
  // Records authored on Platform stay outside every import decision: an
  // import never matches, changes or archives them.
  const authored = placed.filter(({ origin }) => origin === "authoring");
  const candidates = [
    ...authored,
    ...namedBySource.filter((row) => !authored.some(({ id }) => id === row.id)),
  ];
  return { ok: true, value: { authored, candidates } };
}

async function importSource(
  context: GuideArtifactContext,
  command: AuthoringImportCommand,
  source: ImportedArtifactSource,
  candidates: readonly ArtifactRow[],
): Promise<GuideArtifactResult<AuthoringImportOutcome>> {
  const existing =
    candidates.find(({ sourceId }) => sourceId === source.sourceId) ?? null;
  if (existing === null) {
    return createFromSource(context, command, source);
  }
  if (existing.revision !== existing.importedRevision) {
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
  await context.prisma.guideArtifactPlacement.createMany({
    data: [{ artifactId: existing.id, guideId: command.guideId }],
    skipDuplicates: true,
  });
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
  return updateFromSource(context, command, existing, source, sameContent);
}

async function createFromSource(
  context: GuideArtifactContext,
  command: AuthoringImportCommand,
  source: ImportedArtifactSource,
): Promise<GuideArtifactResult<AuthoringImportOutcome>> {
  const artifactId = randomUUID();
  let stored: StoredArtifactFile | null = null;
  if (source.file !== undefined) {
    const file = await context.files.store(artifactId, source.file);
    if (!file.ok) return file;
    stored = file.value;
  }
  try {
    await context.prisma.$transaction(async (transaction) => {
      await transaction.guideArtifact.create({
        data: {
          access: source.access,
          createdBy: command.actor,
          currentVersion: 1,
          id: artifactId,
          importedAt: new Date(),
          importedRevision: 1,
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
    });
  } catch (error) {
    reportDependencyFailure(
      { module: "materials", operation: "createFromSource" },
      error,
    );
    await context.files.discard(stored);
    return dependencyUnavailable();
  }
  await context.files.forgetQuarantine(stored);
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
  context: GuideArtifactContext,
  command: AuthoringImportCommand,
  existing: ArtifactRow,
  source: ImportedArtifactSource,
  sameContent: boolean,
): Promise<GuideArtifactResult<AuthoringImportOutcome>> {
  let stored: StoredArtifactFile | null = null;
  if (!sameContent && source.file !== undefined) {
    const file = await context.files.store(existing.id, source.file);
    if (!file.ok) return file;
    stored = file.value;
  }
  try {
    await context.prisma.$transaction(async (transaction) => {
      let nextVersion: number;
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
        await supersedeVersion(
          transaction,
          existing.id,
          existing.currentVersion,
        );
      }
      // The write only lands on the revision the import decided against.
      // An editor change that arrives in between makes this a no-op, and
      // the artifact is reported as diverged instead of overwritten.
      const revision = existing.revision + 1;
      const applied = await transaction.guideArtifact.updateMany({
        data: {
          access: source.access,
          currentVersion: nextVersion,
          importedAt: new Date(),
          importedRevision: revision,
          purpose: source.purpose,
          revision,
          title: source.title,
          updatedAt: new Date(),
        },
        where: { id: existing.id, revision: existing.revision },
      });
      if (applied.count !== 1) throw new ConcurrentArtifactChange();
    });
  } catch (error) {
    await context.files.discard(stored);
    if (error instanceof ConcurrentArtifactChange) {
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
    return dependencyFailure(
      { module: "materials", operation: "updateFromSource" },
      error,
      dependencyUnavailable(),
    );
  }
  await context.files.forgetQuarantine(stored);
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

/** Authoring artifacts of the Guide that the package no longer names. */
function missingArtifacts(
  authored: readonly ArtifactRow[],
  sourceIds: readonly string[],
): readonly AuthoringImportOutcome[] {
  return authored
    .filter((existing) => !sourceIds.includes(existing.sourceId ?? ""))
    .map((existing) => ({
      artifactId: existing.id,
      outcome: "missing",
      sourceId: existing.sourceId,
      title: existing.title,
    }));
}
