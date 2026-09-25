import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  AUTHORING_ARTIFACT_LIMIT,
  listSchema,
  reusableListSchema,
  uuidSchema,
} from "./guide-artifact-commands.js";
import {
  currentContent,
  dependencyUnavailable,
  failure,
  loadArtifactRow,
  loadPlacedArtifacts,
  projectRow,
  readAccess,
  readyVersion,
  type GuideArtifactContext,
} from "./guide-artifact-records.js";
import type {
  GuideArtifactAccessFacts,
  GuideArtifactDto,
  GuideArtifactFileDelivery,
  GuideArtifactResult,
  ReaderGuideArtifact,
} from "./guide-artifacts.js";

// Reads of Guide Artifacts: author lists, the reader's Guide view, file delivery and access facts.

export async function listGuideArtifacts(
  context: GuideArtifactContext,
  query: { readonly actor: string; readonly guideId: string },
): Promise<GuideArtifactResult<readonly GuideArtifactDto[]>> {
  const { prisma } = context;
  const parsed = listSchema.safeParse(query);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
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
  } catch (error) {
    return dependencyFailure({ module: "materials", operation: "listForGuide" }, error, dependencyUnavailable());
  }
}

export async function listReusableGuideArtifacts(
  context: GuideArtifactContext,
  query: { readonly actor: string },
): Promise<GuideArtifactResult<readonly GuideArtifactDto[]>> {
  const { prisma } = context;
  const parsed = reusableListSchema.safeParse(query);
  if (!parsed.success) return failure({ code: "invalid_artifact" });
  const forbidden = await context.authorize(parsed.data.actor);
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
  } catch (error) {
    return dependencyFailure({ module: "materials", operation: "listReusable" }, error, dependencyUnavailable());
  }
}

export async function loadReaderGuideArtifacts(
  context: GuideArtifactContext,
  guideId: string,
): Promise<GuideArtifactResult<readonly ReaderGuideArtifact[]>> {
  const { prisma } = context;
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
      take: AUTHORING_ARTIFACT_LIMIT,
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
  } catch (error) {
    return dependencyFailure({ module: "materials", operation: "loadForReader" }, error, dependencyUnavailable());
  }
}

export async function loadGuideArtifactFileDelivery(
  context: GuideArtifactContext,
  input: { readonly artifactId: string; readonly guideId: string },
): Promise<GuideArtifactResult<GuideArtifactFileDelivery | null>> {
  const { prisma } = context;
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
  } catch (error) {
    return dependencyFailure({ module: "materials", operation: "loadFileDelivery" }, error, dependencyUnavailable());
  }
}

export async function loadGuideArtifactAccessFacts(
  context: GuideArtifactContext,
  artifactIds: readonly string[],
): Promise<readonly GuideArtifactAccessFacts[]> {
  const { prisma } = context;
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
}
