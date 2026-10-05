import { randomUUID } from "node:crypto";

import type { GuideTasksPrismaClient } from "../../../infrastructure/prisma/index.js";
import type { ContentAccess, Subject } from "../../content-access/index.js";
import { materialId } from "../../../infrastructure/contracts/material-id.js";
import type { GuideDirectory } from "../../materials/index.js";
import {
  taskAccessSchema,
  taskDefinitionSchema,
  taskPublicationSchema,
  type TaskDefinition,
} from "../domain/task-definition.js";

export interface LearningTaskDependencies {
  readonly prisma: GuideTasksPrismaClient;
  readonly directory: Pick<
    GuideDirectory,
    "guides" | "materialsBySource" | "placements"
  >;
  readonly contentAccess: Pick<
    ContentAccess,
    "authorize" | "checkAvailabilityMany"
  >;
  /** Off in production until the owner publishes data policy v4 (#946). */
  readonly submissionsEnabled: boolean;
  readonly clock?: () => Date;
}

export interface CurrentTask {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly access: "free" | "membership";
  readonly guideId: string;
  readonly chapterId: string;
  readonly position: number;
  readonly relatedMaterialSourceIds: readonly string[];
  readonly publicationState: "published" | "unpublished";
  readonly version: number;
  readonly definition: TaskDefinition;
  readonly definitionDigest: string;
}

/** The task by code with its current Task Version; `null` when no such task exists. */
export async function findCurrentTask(
  prisma: Pick<GuideTasksPrismaClient, "guideTask" | "guideTaskVersion">,
  code: string,
): Promise<CurrentTask | null> {
  const task = await prisma.guideTask.findUnique({ where: { code } });
  if (task === null) return null;
  const version = await prisma.guideTaskVersion.findUniqueOrThrow({
    where: {
      taskId_version: { taskId: task.id, version: task.currentVersion },
    },
  });
  return {
    id: task.id,
    code: task.code,
    title: task.title,
    access: taskAccessSchema.parse(task.access),
    guideId: task.guideId,
    chapterId: task.chapterId,
    position: task.position,
    relatedMaterialSourceIds: task.relatedMaterialSourceIds,
    publicationState: taskPublicationSchema.parse(task.publicationState),
    version: task.currentVersion,
    definition: taskDefinitionSchema.parse(version.definition),
    definitionDigest: version.definitionDigest,
  };
}

export type TaskAccess = "open" | "closed" | "unavailable";

/** One Content Access decision on a Guide Task; a dependency failure is not a closed task. */
export async function decideTaskAccess(
  contentAccess: Pick<ContentAccess, "authorize">,
  subject: Subject,
  taskId: string,
  enforcementPoint: "guide_task_read" | "guide_task_submit",
): Promise<TaskAccess> {
  const decision = await contentAccess.authorize({
    subject,
    resource: { kind: "guideTask", taskId },
    action: "read",
    enforcementPoint,
    correlationId: randomUUID(),
  });
  if (decision.effect === "allow") return "open";
  return decision.reason === "dependency_unavailable"
    ? "unavailable"
    : "closed";
}

/** Published related Materials in authored order with the subject's availability. */
export async function readRelatedMaterials(
  dependencies: Pick<LearningTaskDependencies, "directory" | "contentAccess">,
  subject: Subject,
  sourceIds: readonly string[],
): Promise<
  readonly {
    readonly slug: string;
    readonly title: string;
    readonly availability: "available" | "locked" | "unavailable";
  }[]
> {
  const found = new Map(
    (await dependencies.directory.materialsBySource(sourceIds)).map((item) => [
      item.sourceId,
      item,
    ]),
  );
  const published = sourceIds.flatMap((sourceId) => {
    const material = found.get(sourceId);
    return material?.published === null || material === undefined
      ? []
      : [{ materialId: material.materialId, ...material.published }];
  });
  if (published.length === 0) return [];
  const availability = await dependencies.contentAccess.checkAvailabilityMany({
    subject,
    operations: published.map((material) => ({
      itemId: material.materialId,
      resource: {
        kind: "material" as const,
        materialId: materialId(material.materialId),
      },
      action: "read" as const,
    })),
    enforcementPoint: "guide_task_read",
    correlationId: randomUUID(),
  });
  if (!availability.ok) throw new Error(availability.error.code);
  const byId = new Map(
    availability.items.map((item) => [item.itemId, item.availability]),
  );
  return published.map((material) => ({
    slug: material.slug,
    title: material.title,
    availability: byId.get(material.materialId) ?? "unavailable",
  }));
}
