import { z } from "zod";
import { idSchema, revisionSchema } from "./pricing.js";

/**
 * Этап продаж потока продукта. Он выбирает, что обещает страница и куда ведёт её кнопка, но не
 * включает продажу: деньги принимаются, только пока у предложения продукта включена продажа.
 * `announcement` — анонс без оплаты, `preorder` — предзаказ до старта, `running` — поток идёт,
 * `between` — курс открыт, а следующий поток ещё не назначен.
 */
export const cohortStageSchema = z.enum([
  "announcement",
  "preorder",
  "running",
  "between",
]);
export type CohortStage = z.infer<typeof cohortStageSchema>;

/** Календарная дата старта без времени и часового пояса: поток стартует в день, а не в момент. */
export const cohortStartSchema = z.iso.date();

const cohortFields = {
  /** Продукт, чей это поток; у продукта один текущий поток. */
  guideId: idSchema,
  name: z.string().trim().min(1).max(120),
  stage: cohortStageSchema,
  startsOn: cohortStartSchema.nullable(),
  /** Что ждёт следующих участников между потоками, например «эфир 15 декабря». */
  nextEvent: z.string().trim().max(200),
};

/**
 * Дата старта нужна всем этапам, кроме «между потоками», а этап «между потоками» без события
 * пообещал бы следующий поток пустой строкой.
 */
function completeForStage(
  value: { stage: CohortStage; startsOn: string | null; nextEvent: string },
  context: z.RefinementCtx,
): void {
  if (value.stage !== "between" && value.startsOn === null)
    context.addIssue({
      code: "custom",
      path: ["startsOn"],
      message: "Этапу нужна дата старта",
    });
  if (value.stage === "between" && value.nextEvent === "")
    context.addIssue({
      code: "custom",
      path: ["nextEvent"],
      message: "Между потоками нужно событие",
    });
}

/** Что владелец задаёт в каталоге. */
export const cohortValueSchema = z
  .strictObject(cohortFields)
  .superRefine(completeForStage);

/** Текущий поток продукта, как его читают страница и бот. */
export const guideCohortSchema = z.strictObject({
  ...cohortFields,
  revision: revisionSchema,
});
export type GuideCohort = z.infer<typeof guideCohortSchema>;
