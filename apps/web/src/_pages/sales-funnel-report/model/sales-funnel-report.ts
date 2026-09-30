import { z } from "zod";

const countSchema = z.int().nonnegative().nullable();
const countsSchema = z.strictObject({
  entered: countSchema,
  consented: countSchema,
  openedChapter: countSchema,
  checkout: countSchema,
  paid: countSchema,
});

/** Ответ `readSalesFunnelReport`: адаптер проверяет его, прежде чем показать. */
export const salesFunnelReportSchema = z.strictObject({
  generatedAt: z.iso.datetime({ offset: true }),
  period: z.strictObject({
    from: z.iso.datetime({ offset: true }),
    to: z.iso.datetime({ offset: true }),
  }),
  guides: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      chapters: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
    }),
  ),
  selection: z
    .strictObject({ guideId: z.uuid(), chapterId: z.uuid().nullable() })
    .nullable(),
  lastBotEventReceivedAt: z.iso.datetime({ offset: true }).nullable(),
  rows: z.array(
    z.strictObject({
      source: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("label"), code: z.string() }),
        z.strictObject({ kind: z.literal("unlabelled") }),
        z.strictObject({ kind: z.literal("outside_bot") }),
      ]),
      counts: countsSchema,
    }),
  ),
  total: countsSchema,
});
export type SalesFunnelReport = z.infer<typeof salesFunnelReportSchema>;
type Counts = SalesFunnelReport["total"];

/** Шаги воронки по порядку. Первые два считают контакты бота, остальные — аккаунты Platform. */
export const funnelSteps = [
  { key: "entered", label: "Вход в бот", unit: "контакты бота" },
  { key: "consented", label: "Согласие на рассылку", unit: "контакты бота" },
  { key: "openedChapter", label: "Открыл главу", unit: "аккаунты" },
  { key: "checkout", label: "Перешёл к оплате", unit: "аккаунты" },
  { key: "paid", label: "Оплатил", unit: "аккаунты" },
] as const satisfies readonly {
  readonly key: keyof Counts;
  readonly label: string;
  readonly unit: string;
}[];

/** Число одного шага; `null` — шаг к строке не относится или ещё не измеряется. */
export interface StepCount {
  readonly step: (typeof funnelSteps)[number]["key"];
  readonly value: number | null;
}

export interface SalesFunnelReportView {
  /** Даты периода включительно, по московскому времени, в виде `YYYY-MM-DD`. */
  readonly from: string;
  readonly to: string;
  readonly guides: SalesFunnelReport["guides"];
  readonly guideId: string | null;
  readonly chapterId: string | null;
  readonly chapterName: string | null;
  readonly generatedAt: string;
  readonly lastBotEventAt: string | null;
  readonly rows: readonly {
    readonly key: string;
    readonly label: string;
    readonly counts: readonly StepCount[];
  }[];
  readonly total: readonly StepCount[];
  readonly notice: string | null;
}

const MOSCOW = "Europe/Moscow";
/** Москва живёт без перехода на летнее время: смещение постоянно. */
const MOSCOW_OFFSET_MS = 3 * 3_600_000;
const MOSCOW_OFFSET = "+03:00";
const DAY_MS = 86_400_000;
const DEFAULT_DAYS = 30;
export const correctedPeriodNotice = `Период задан неверно: показаны последние ${String(DEFAULT_DAYS)} дней.`;
const dateSchema = z.iso.date();

/** Календарная дата по Москве для мгновения. */
function moscowDate(instant: Date): string {
  return new Date(instant.getTime() + MOSCOW_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

/** Начало московских суток даты как мгновение. */
function moscowStart(date: string): Date {
  return new Date(`${date}T00:00:00${MOSCOW_OFFSET}`);
}

/**
 * Период отчёта из параметров адреса: даты включительно по Москве. Пустой или неверный период
 * заменяется последними тридцатью днями, и страница говорит об этом.
 */
export function readReportPeriod(
  params: { readonly from?: string; readonly to?: string },
  now: Date,
): {
  readonly from: string;
  readonly to: string;
  readonly query: { readonly from: string; readonly to: string };
  readonly corrected: boolean;
} {
  const today = moscowDate(now);
  const fallbackFrom = moscowDate(
    new Date(moscowStart(today).getTime() - (DEFAULT_DAYS - 1) * DAY_MS),
  );
  const requested =
    params.from === undefined && params.to === undefined
      ? undefined
      : { from: params.from, to: params.to };
  const valid =
    requested !== undefined &&
    dateSchema.safeParse(requested.from).success &&
    dateSchema.safeParse(requested.to).success &&
    (requested.from ?? "") <= (requested.to ?? "");
  const from = valid ? (requested.from ?? fallbackFrom) : fallbackFrom;
  const to = valid ? (requested.to ?? today) : today;
  return {
    from,
    to,
    query: {
      from: moscowStart(from).toISOString(),
      to: new Date(moscowStart(to).getTime() + DAY_MS).toISOString(),
    },
    corrected: requested !== undefined && !valid,
  };
}

const moscowDateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: MOSCOW,
});

function sourceLabel(source: SalesFunnelReport["rows"][number]["source"]) {
  switch (source.kind) {
    case "label":
      // Бот различает метки маркетинга префиксом `m_`; владельцу он ничего не говорит.
      return source.code.startsWith("m_") ? source.code.slice(2) : source.code;
    case "unlabelled":
      return "Без метки";
    case "outside_bot":
      return "Не через бота";
  }
}

function sourceKey(source: SalesFunnelReport["rows"][number]["source"]) {
  return source.kind === "label" ? `label:${source.code}` : source.kind;
}

const countsOf = (counts: Counts): readonly StepCount[] =>
  funnelSteps.map((step) => ({ step: step.key, value: counts[step.key] }));

export function presentSalesFunnelReport(
  report: SalesFunnelReport,
  period: {
    readonly from: string;
    readonly to: string;
    readonly corrected: boolean;
  },
): SalesFunnelReportView {
  const guide = report.guides.find(
    (item) => item.id === report.selection?.guideId,
  );
  const chapter = guide?.chapters.find(
    (item) => item.id === report.selection?.chapterId,
  );
  return {
    from: period.from,
    to: period.to,
    guides: report.guides,
    guideId: guide?.id ?? null,
    chapterId: chapter?.id ?? null,
    chapterName: chapter?.name ?? null,
    generatedAt: moscowDateTime.format(new Date(report.generatedAt)),
    lastBotEventAt:
      report.lastBotEventReceivedAt === null
        ? null
        : moscowDateTime.format(new Date(report.lastBotEventReceivedAt)),
    rows: report.rows.map((row) => ({
      key: sourceKey(row.source),
      label: sourceLabel(row.source),
      counts: countsOf(row.counts),
    })),
    total: countsOf(report.total),
    notice: period.corrected ? correctedPeriodNotice : null,
  };
}
