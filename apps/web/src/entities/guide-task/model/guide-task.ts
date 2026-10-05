import { z } from "zod";

/** A published Guide Task as the programme shows it inside its chapter (#947). */
export const guideChapterTaskSchema = z
  .object({
    code: z.string(),
    title: z.string(),
    access: z.enum(["free", "membership"]),
    afterMaterialId: z.string().nullable(),
    availability: z.enum(["available", "locked", "unavailable"]),
    lastSubmittedAt: z.iso.datetime().nullable(),
  })
  .strict();

export type GuideChapterTask = z.infer<typeof guideChapterTaskSchema>;

/**
 * Where the tasks of one chapter stand among its Materials: right after the Material each names,
 * in author order, or at the start of the chapter when it names none or a Material that left the
 * chapter. Material ordinals are untouched: a task is not a step of the Guide main path.
 */
export function placeChapterTasks(
  tasks: readonly GuideChapterTask[],
  materialIds: readonly string[],
): {
  readonly leading: readonly GuideChapterTask[];
  readonly after: ReadonlyMap<string, readonly GuideChapterTask[]>;
} {
  const present = new Set(materialIds);
  const leading: GuideChapterTask[] = [];
  const after = new Map<string, GuideChapterTask[]>();
  for (const task of tasks) {
    const anchor = task.afterMaterialId;
    if (anchor === null || !present.has(anchor)) {
      leading.push(task);
      continue;
    }
    after.set(anchor, [...(after.get(anchor) ?? []), task]);
  }
  return { leading, after };
}

/** The phrase a learner gives any agent: the task code is all the agent needs (#939). */
export function guideTaskAgentPhrase(code: string): string {
  return `Проверь моё задание ${code} через учебный MCP Sachkov Inside и помоги его сдать.`;
}

/** «5 октября»: the day of a submission in the reader's language, stable across renders. */
export function formatSubmissionDay(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "Europe/Moscow",
  }).format(new Date(iso));
}
