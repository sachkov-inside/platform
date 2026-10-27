import { z } from "zod";

/**
 * Общие части ответов Обзора админки (#1719): период, ряды показателей и события. Их читают
 * `GET admin/overview` и `GET admin/products/:productId/overview`; каждый ответ проверяется здесь,
 * а не типами сгенерированного клиента.
 */

/** Периоды Обзора в днях, считая сегодняшний день по Москве; тридцать идут по умолчанию. */
export const overviewPeriodDays = [7, 30, 90] as const;
export type OverviewPeriodDays = (typeof overviewPeriodDays)[number];
export const defaultOverviewPeriod: OverviewPeriodDays = 30;

const periodDaysSchema = z.union(
  overviewPeriodDays.map((days) => z.literal(days)),
);

/** `"7"`, `"30"` или `"90"` из адреса; любое другое значение дает период по умолчанию. */
export function parseOverviewPeriod(
  value: string | null | undefined,
): OverviewPeriodDays {
  return (
    z.coerce
      .number()
      .pipe(periodDaysSchema)
      .safeParse(value ?? undefined).data ?? defaultOverviewPeriod
  );
}

const day = z.iso.date();
const instant = z.iso.datetime({ offset: true });

const periodRangeSchema = z.strictObject({
  from: instant,
  to: instant,
  firstDay: day,
  lastDay: day,
});

export const overviewPeriodSchema = z.strictObject({
  days: periodDaysSchema,
  timeZone: z.literal("Europe/Moscow"),
  current: periodRangeSchema,
  previous: periodRangeSchema,
});
export type OverviewPeriod = z.infer<typeof overviewPeriodSchema>;

/** Ряд по дням: ровно столько дней, сколько в периоде, по возрастанию. */
export const overviewSeriesSchema = z.strictObject({
  total: z.int(),
  daily: z.array(z.strictObject({ date: day, value: z.int() })),
});
export type OverviewSeries = z.infer<typeof overviewSeriesSchema>;

const unavailable = z.strictObject({ state: z.literal("unavailable") });

const readyMetric = z.strictObject({
  state: z.literal("ready"),
  current: overviewSeriesSchema,
  previous: overviewSeriesSchema,
});

/** Показатель за период и прошлый такой же период; `unavailable` никогда не читается как ноль. */
export const overviewMetricSchema = z.discriminatedUnion("state", [
  readyMetric,
  unavailable,
]);
export type OverviewMetric = z.infer<typeof overviewMetricSchema>;
export type ReadyOverviewMetric = Extract<
  OverviewMetric,
  { readonly state: "ready" }
>;

/** Способ получения доступа так, как его считает Обзор. */
export const overviewOriginSchema = z.enum([
  "purchase",
  "course_activation",
  "manual",
  "other",
]);
export type OverviewOrigin = z.infer<typeof overviewOriginSchema>;

export const overviewByOriginSchema = z.strictObject({
  purchase: z.int().nonnegative(),
  course_activation: z.int().nonnegative(),
  manual: z.int().nonnegative(),
  other: z.int().nonnegative(),
});
export type OverviewByOrigin = z.infer<typeof overviewByOriginSchema>;

/** Новые доступы: показатель и разбивка текущего периода по способу получения. */
export const newAccessMetricSchema = z.discriminatedUnion("state", [
  readyMetric.extend({ byOrigin: overviewByOriginSchema }),
  unavailable,
]);
export type NewAccessMetric = z.infer<typeof newAccessMetricSchema>;

/** Человек события: имя и @username Telegram. Email в Обзор не приходит. */
const eventPersonSchema = z.strictObject({
  accountId: z.uuid(),
  name: z.string().nullable(),
  username: z.string().nullable(),
});
export type OverviewEventPerson = z.infer<typeof eventPersonSchema>;

const eventProductSchema = z.strictObject({ id: z.uuid(), name: z.string() });

export const overviewEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("payment_confirmed"),
    occurredAt: instant,
    person: eventPersonSchema,
    purchaseRef: z.uuid(),
    amountKopecks: z.int(),
    product: eventProductSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("access_issued"),
    occurredAt: instant,
    person: eventPersonSchema,
    origin: overviewOriginSchema,
    product: eventProductSchema,
  }),
  z.strictObject({
    kind: z.enum(["access_revoked", "access_restored"]),
    occurredAt: instant,
    person: eventPersonSchema,
    product: eventProductSchema,
  }),
  z.strictObject({
    kind: z.literal("submission"),
    occurredAt: instant,
    person: eventPersonSchema,
    submissionId: z.uuid(),
    commented: z.boolean(),
    product: eventProductSchema.nullable(),
    taskTitle: z.string().nullable(),
  }),
]);
export type OverviewEvent = z.infer<typeof overviewEventSchema>;
