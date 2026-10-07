import { z } from "zod";

/** A published Product Task as the programme shows it inside its chapter (#947). */
export const productChapterTaskSchema = z
  .object({
    code: z.string(),
    title: z.string(),
    access: z.enum(["free", "closed"]),
    afterMaterialId: z.string().nullable(),
    availability: z.enum(["available", "locked", "unavailable"]),
    lastSubmittedAt: z.iso.datetime().nullable(),
  })
  .strict();

export type ProductChapterTask = z.infer<typeof productChapterTaskSchema>;

/**
 * Where the tasks of one chapter stand among its Materials: right after the Material each names,
 * in author order, or at the start of the chapter when it names none or a Material that left the
 * chapter. Material ordinals are untouched: a task is not a step of the Product main path.
 */
export function placeChapterTasks(
  tasks: readonly ProductChapterTask[],
  materialIds: readonly string[],
): {
  readonly leading: readonly ProductChapterTask[];
  readonly after: ReadonlyMap<string, readonly ProductChapterTask[]>;
} {
  const present = new Set(materialIds);
  const leading: ProductChapterTask[] = [];
  const after = new Map<string, ProductChapterTask[]>();
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
export function productTaskAgentPhrase(code: string): string {
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

/** «5 октября, 16:40»: the moment of a submission in Moscow time, stable across renders. */
export function formatSubmissionMoment(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Moscow",
  }).format(new Date(iso));
}
