import { randomUUID } from "node:crypto";
import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { Subject } from "../../../content-access/index.js";
import { taskAccessSchema } from "../../domain/task-definition.js";
import type { LearningTaskDependencies } from "../../shared/learning-task-dependencies.js";
import {
  scope,
  systemFailure,
  type Result,
  type SystemError,
} from "../../shared/result.js";

// A Guide holds a few dozen tasks; the bounds only stop a runaway programme.
const MAX_TASKS = 500;
const LOOKUP_BATCH = 100;

export const chapterTasksQuerySchema = z.object({ guideId: z.uuid() }).strict();

/** A published task as its Guide programme shows it inside a chapter. */
export interface ChapterTask {
  readonly code: string;
  readonly title: string;
  readonly access: "free" | "membership";
  readonly chapterId: string;
  /**
   * The published Material of the same chapter the task follows; `null` puts it at the start of
   * the chapter, also when that Material has left the chapter or is not published.
   */
  readonly afterMaterialId: string | null;
  readonly availability: "available" | "locked" | "unavailable";
  /**
   * The subject's own latest submission; `null` for an anonymous subject and while the task is
   * closed to the subject.
   */
  readonly lastSubmittedAt: string | null;
}

export type ListChapterTasksError =
  { readonly code: "invalid_request_shape" } | SystemError;

/**
 * Published tasks of one Guide in chapter order with their place among the chapter's Materials.
 * The Guide main path, its ordinals and Guide Progress do not include tasks (ADR 0030).
 */
export async function listChapterTasks(
  dependencies: LearningTaskDependencies,
  input: { readonly subject: Subject } & Readonly<Record<string, unknown>>,
): Promise<
  Result<{ readonly tasks: readonly ChapterTask[] }, ListChapterTasksError>
> {
  const { subject, ...query } = input;
  const parsed = chapterTasksQuerySchema.safeParse(query);
  if (!parsed.success)
    return { ok: false, error: { code: "invalid_request_shape" } };
  const guideId = parsed.data.guideId;
  try {
    const rows = await dependencies.prisma.guideTask.findMany({
      where: { guideId, publicationState: "published" },
      orderBy: [{ chapterId: "asc" }, { position: "asc" }, { code: "asc" }],
      take: MAX_TASKS,
    });
    if (rows.length === 0) return { ok: true, value: { tasks: [] } };
    const availabilityById = new Map<
      string,
      "available" | "locked" | "unavailable"
    >();
    const anchors = [
      ...new Set(
        rows.flatMap((row) =>
          row.afterMaterialSourceId === null ? [] : [row.afterMaterialSourceId],
        ),
      ),
    ];
    const placements = new Map<
      string,
      {
        readonly materialId: string;
        readonly chapterId: string | null;
        readonly published: boolean;
      }
    >();
    for (let start = 0; start < rows.length; start += LOOKUP_BATCH) {
      const batch = rows.slice(start, start + LOOKUP_BATCH);
      const availability =
        await dependencies.contentAccess.checkAvailabilityMany({
          subject,
          operations: batch.map((row) => ({
            itemId: row.id,
            resource: { kind: "guideTask" as const, taskId: row.id },
            action: "read" as const,
          })),
          enforcementPoint: "guide_task_read",
          correlationId: randomUUID(),
        });
      if (!availability.ok) throw new Error(availability.error.code);
      for (const item of availability.items)
        availabilityById.set(item.itemId, item.availability);
    }
    for (let start = 0; start < anchors.length; start += LOOKUP_BATCH)
      for (const placement of await dependencies.directory.placements(
        guideId,
        anchors.slice(start, start + LOOKUP_BATCH),
      ))
        placements.set(placement.sourceId, placement);
    const lastSubmissions =
      subject.kind === "account"
        ? await dependencies.prisma.guideTaskSubmission.groupBy({
            by: ["taskId"],
            where: {
              accountId: subject.accountId,
              taskId: { in: rows.map((row) => row.id) },
            },
            _max: { submittedAt: true },
          })
        : [];
    const lastByTask = new Map(
      lastSubmissions.map((row) => [row.taskId, row._max.submittedAt]),
    );
    return {
      ok: true,
      value: {
        tasks: rows.map((row) => {
          const availability = availabilityById.get(row.id) ?? "unavailable";
          const anchor =
            row.afterMaterialSourceId === null
              ? undefined
              : placements.get(row.afterMaterialSourceId);
          return {
            code: row.code,
            title: row.title,
            access: taskAccessSchema.parse(row.access),
            chapterId: row.chapterId,
            afterMaterialId:
              anchor?.chapterId === row.chapterId && anchor.published
                ? anchor.materialId
                : null,
            availability,
            // Submissions return with access (#939): a closed task shows no mark of them.
            lastSubmittedAt:
              availability === "available"
                ? (lastByTask.get(row.id)?.toISOString() ?? null)
                : null,
          };
        }),
      },
    };
  } catch (error) {
    return dependencyFailure(
      scope("listChapterTasks"),
      error,
      systemFailure(error),
    );
  }
}
