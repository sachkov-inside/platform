import { randomUUID } from "node:crypto";

import {
  dependencyFailure,
  reportDependencyFailure,
} from "../../../../infrastructure/observability/index.js";
import {
  archiveSchema,
  createSchema,
  guidesSchema,
  materialsSchema,
  removeSchema,
  replaceSchema,
  updateSchema,
} from "./guide-artifact-commands.js";
import type { StoredArtifactFile } from "./guide-artifact-files.js";
import {
  dependencyUnavailable,
  failure,
  projectOrFail,
  reopenVersionOnAccessChange,
  supersedeVersion,
  versionRow,
  type GuideArtifactContext,
} from "./guide-artifact-records.js";
import type {
  CreateGuideArtifactCommand,
  GuideArtifactDto,
  GuideArtifactResult,
  RemoveGuideArtifactCommand,
  ReplaceGuideArtifactContentCommand,
  SetGuideArtifactArchivedCommand,
  SetGuideArtifactGuidesCommand,
  SetGuideArtifactMaterialsCommand,
  UpdateGuideArtifactCommand,
} from "./guide-artifacts.js";

// Author edits of one Guide Artifact. Each operation parses, authorizes, stores new bytes before
// its transaction and forgets them when the transaction fails.

export async function createGuideArtifact(
  context: GuideArtifactContext,
  command: CreateGuideArtifactCommand,
): Promise<GuideArtifactResult<GuideArtifactDto>> {
  const { prisma } = context;
  const parsed = createSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  try {
    const guide = await prisma.guide.findUnique({
      select: { id: true },
      where: { id: parsed.data.guideId },
    });
    if (guide === null) return failure({ code: "guide_not_found" });
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "create" },
      error,
      dependencyUnavailable(),
    );
  }

  const artifactId = randomUUID();
  let stored: StoredArtifactFile | null = null;
  if (parsed.data.kind === "file") {
    const file = await context.files.store(artifactId, parsed.data.file);
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
    });
  } catch (error) {
    reportDependencyFailure(
      { module: "materials", operation: "create" },
      error,
    );
    await context.files.discard(stored);
    return dependencyUnavailable();
  }
  await context.files.forgetQuarantine(stored);
  return projectOrFail(prisma, artifactId);
}

export async function updateGuideArtifact(
  context: GuideArtifactContext,
  command: UpdateGuideArtifactCommand,
): Promise<GuideArtifactResult<GuideArtifactDto>> {
  const { prisma } = context;
  const parsed = updateSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
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
          // Any editor change advances the revision, so a later import
          // reports a hand-edited artifact instead of overwriting it.
          revision: { increment: 1 },
          title: parsed.data.metadata.title,
          updatedAt: new Date(),
        },
        where: { id: current.id },
      });
    });
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "update" },
      error,
      dependencyUnavailable(),
    );
  }
  return projectOrFail(prisma, parsed.data.artifactId);
}

export async function replaceGuideArtifactContent(
  context: GuideArtifactContext,
  command: ReplaceGuideArtifactContentCommand,
): Promise<GuideArtifactResult<GuideArtifactDto>> {
  const { prisma } = context;
  const parsed = replaceSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  let currentVersion: number;
  try {
    const current = await prisma.guideArtifact.findUnique({
      select: { currentVersion: true },
      where: { id: parsed.data.artifactId },
    });
    if (current === null) return failure({ code: "artifact_not_found" });
    currentVersion = current.currentVersion;
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "replaceContent" },
      error,
      dependencyUnavailable(),
    );
  }

  let stored: StoredArtifactFile | null = null;
  if (parsed.data.kind === "file") {
    const file = await context.files.store(
      parsed.data.artifactId,
      parsed.data.file,
    );
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
      await supersedeVersion(
        transaction,
        parsed.data.artifactId,
        currentVersion,
      );
      await transaction.guideArtifact.update({
        data: {
          currentVersion: nextVersion,
          revision: { increment: 1 },
          updatedAt: new Date(),
        },
        where: { id: parsed.data.artifactId },
      });
    });
  } catch (error) {
    reportDependencyFailure(
      { module: "materials", operation: "replaceContent" },
      error,
    );
    await context.files.discard(stored);
    return dependencyUnavailable();
  }
  await context.files.forgetQuarantine(stored);
  return projectOrFail(prisma, parsed.data.artifactId);
}

export async function setGuideArtifactArchived(
  context: GuideArtifactContext,
  command: SetGuideArtifactArchivedCommand,
): Promise<GuideArtifactResult<GuideArtifactDto>> {
  const { prisma } = context;
  const parsed = archiveSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  try {
    const changed = await prisma.guideArtifact.updateMany({
      data: {
        archivedAt: parsed.data.archived ? new Date() : null,
        revision: { increment: 1 },
        state: parsed.data.archived ? "archived" : "active",
        updatedAt: new Date(),
      },
      where: { id: parsed.data.artifactId },
    });
    if (changed.count === 0) return failure({ code: "artifact_not_found" });
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "setArchived" },
      error,
      dependencyUnavailable(),
    );
  }
  return projectOrFail(prisma, parsed.data.artifactId);
}

export async function setGuideArtifactGuides(
  context: GuideArtifactContext,
  command: SetGuideArtifactGuidesCommand,
): Promise<GuideArtifactResult<GuideArtifactDto>> {
  const { prisma } = context;
  const parsed = guidesSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
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
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "setGuides" },
      error,
      dependencyUnavailable(),
    );
  }
  return projectOrFail(prisma, parsed.data.artifactId);
}

export async function setGuideArtifactMaterials(
  context: GuideArtifactContext,
  command: SetGuideArtifactMaterialsCommand,
): Promise<GuideArtifactResult<GuideArtifactDto>> {
  const { prisma } = context;
  const parsed = materialsSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
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
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "setMaterials" },
      error,
      dependencyUnavailable(),
    );
  }
  return projectOrFail(prisma, parsed.data.artifactId);
}

export async function removeGuideArtifact(
  context: GuideArtifactContext,
  command: RemoveGuideArtifactCommand,
): Promise<GuideArtifactResult<Readonly<{ artifactId: string }>>> {
  const { prisma } = context;
  const parsed = removeSchema.safeParse(command);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
  if (forbidden !== null) return failure(forbidden);
  try {
    const artifact = await prisma.guideArtifact.findUnique({
      include: { materialLinks: true, placements: true },
      where: { id: parsed.data.artifactId },
    });
    if (artifact === null) return failure({ code: "artifact_not_found" });
    if (artifact.placements.length > 0 || artifact.materialLinks.length > 0) {
      return failure({
        code: "artifact_referenced",
        guideIds: artifact.placements.map(({ guideId }) => guideId),
      });
    }
    await prisma.guideArtifact.delete({
      where: { id: parsed.data.artifactId },
    });
  } catch (error) {
    return dependencyFailure(
      { module: "materials", operation: "remove" },
      error,
      dependencyUnavailable(),
    );
  }
  return { ok: true, value: { artifactId: parsed.data.artifactId } };
}
