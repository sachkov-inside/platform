import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { Subject } from "../../../content-access/index.js";
import type { DirectoryGuide } from "../../../materials/index.js";
import type { LearningTaskDependencies } from "../../shared/learning-task-dependencies.js";
import {
  scope,
  systemFailure,
  type Result,
  type SystemError,
} from "../../shared/result.js";

// The catalogue holds a few dozen tasks; the bound only stops a runaway list.
const MAX_TASKS = 500;
const ACCESS_BATCH = 100;

export const learningTasksQuerySchema = z
  .object({ guideSlug: z.string().min(1).max(120).optional() })
  .strict();

export interface LearningTaskSummary {
  readonly code: string;
  readonly title: string;
  readonly guide: { readonly slug: string; readonly name: string };
  readonly chapter: { readonly name: string; readonly ordinal: number };
  /** Order of the task inside its chapter, from 1. */
  readonly position: number;
  readonly currentVersion: number;
  /** The subject's own latest submission of this task, if any. */
  readonly lastSubmittedAt: string | null;
}

export type ListLearningTasksError =
  | { readonly code: "invalid_request_shape" }
  | SystemError;

/** Published tasks the subject can open, in programme order: Guide, chapter, order in chapter. */
export async function listLearningTasks(
  dependencies: LearningTaskDependencies,
  input: { readonly subject: Subject; readonly guideSlug?: string | undefined },
): Promise<
  Result<{ readonly tasks: readonly LearningTaskSummary[] }, ListLearningTasksError>
> {
  const { subject, ...query } = input;
  const parsed = learningTasksQuerySchema.safeParse(query);
  if (!parsed.success)
    return { ok: false, error: { code: "invalid_request_shape" } };
  try {
    let guideFilter: readonly DirectoryGuide[] | undefined;
    if (parsed.data.guideSlug !== undefined) {
      guideFilter = await dependencies.directory.guides({
        slugs: [parsed.data.guideSlug],
      });
      if (guideFilter.length === 0) return { ok: true, value: { tasks: [] } };
    }
    const rows = await dependencies.prisma.guideTask.findMany({
      where: {
        publicationState: "published",
        ...(guideFilter === undefined
          ? {}
          : { guideId: { in: guideFilter.map((guide) => guide.id) } }),
      },
      orderBy: [{ position: "asc" }, { code: "asc" }],
      take: MAX_TASKS,
    });
    const open = new Set<string>();
    for (let start = 0; start < rows.length; start += ACCESS_BATCH) {
      const batch = rows.slice(start, start + ACCESS_BATCH);
      const availability = await dependencies.contentAccess.checkAvailabilityMany(
        {
          subject,
          operations: batch.map((row) => ({
            itemId: row.id,
            resource: { kind: "guideTask" as const, taskId: row.id },
            action: "read" as const,
          })),
          enforcementPoint: "guide_task_read",
          correlationId: batch[0]?.id ?? "",
        },
      );
      if (!availability.ok) throw new Error(availability.error.code);
      for (const item of availability.items)
        if (item.availability === "available") open.add(item.itemId);
    }
    const visible = rows.filter((row) => open.has(row.id));
    const guideIds = [...new Set(visible.map((row) => row.guideId))];
    const guides = new Map<string, DirectoryGuide>();
    for (let start = 0; start < guideIds.length; start += ACCESS_BATCH)
      for (const guide of await dependencies.directory.guides({
        ids: guideIds.slice(start, start + ACCESS_BATCH),
      }))
        guides.set(guide.id, guide);
    const lastSubmissions =
      subject.kind === "account" && visible.length > 0
        ? await dependencies.prisma.guideTaskSubmission.groupBy({
            by: ["taskId"],
            where: {
              accountId: subject.accountId,
              taskId: { in: visible.map((row) => row.id) },
            },
            _max: { submittedAt: true },
          })
        : [];
    const lastByTask = new Map(
      lastSubmissions.map((row) => [row.taskId, row._max.submittedAt]),
    );
    const tasks = visible.flatMap((row): LearningTaskSummary[] => {
      const guide = guides.get(row.guideId);
      const chapter = guide?.chapters.find((item) => item.id === row.chapterId);
      if (guide === undefined || guide.archived || chapter === undefined)
        return [];
      return [
        {
          code: row.code,
          title: row.title,
          guide: { slug: guide.slug, name: guide.name },
          chapter: { name: chapter.name, ordinal: chapter.ordinal },
          position: row.position,
          currentVersion: row.currentVersion,
          lastSubmittedAt: lastByTask.get(row.id)?.toISOString() ?? null,
        },
      ];
    });
    tasks.sort(
      (left, right) =>
        left.guide.name.localeCompare(right.guide.name) ||
        left.guide.slug.localeCompare(right.guide.slug) ||
        left.chapter.ordinal - right.chapter.ordinal ||
        left.position - right.position ||
        left.code.localeCompare(right.code),
    );
    return { ok: true, value: { tasks } };
  } catch (error) {
    return dependencyFailure(scope("listLearningTasks"), error, systemFailure(error));
  }
}
