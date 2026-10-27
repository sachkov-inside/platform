import { z } from "zod";

import {
  addMoscowDays,
  moscowDayOf,
  moscowDayStart,
} from "@/shared/lib/moscow-day";
import { MOSCOW_TIME_ZONE } from "@/shared/lib/moscow-format";
import {
  defaultSalesFunnelPeriodPreset,
  type SalesFunnelPeriodPreset,
} from "@/shared/routing/authoring";

const amountSchema = z.int().nonnegative();
const countSchema = amountSchema.nullable();
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
  products: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      chapters: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
    }),
  ),
  selection: z
    .strictObject({ productId: z.uuid(), chapterId: z.uuid().nullable() })
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
  waitlist: z
    .strictObject({
      intakeId: z.uuid(),
      name: z.string(),
      active: amountSchema,
      joined: amountSchema,
      withdrawn: amountSchema,
      sources: z.array(
        z.strictObject({
          source: z.string().nullable(),
          active: amountSchema,
          joined: amountSchema,
          withdrawn: amountSchema,
        }),
      ),
      weeks: z.array(
        z.strictObject({
          from: z.iso.date(),
          joined: amountSchema,
          withdrawn: amountSchema,
        }),
      ),
    })
    .nullable(),
  surveyRespondents: z
    .strictObject({
      uploaded: amountSchema,
      issued: amountSchema,
      paid: countSchema,
    })
    .nullable(),
});
export type SalesFunnelReport = z.infer<typeof salesFunnelReportSchema>;
type Counts = SalesFunnelReport["total"];

/**
 * Шаги воронки по порядку. Первый считает контакты бота, остальные аккаунты Platform. Согласие на
 * рассылку больше не шаг: по #1693 явный выбор не обязателен для покупки, поэтому отчёт показывает
 * его отдельной исторической метрикой (`historicalConsent`).
 */
export const funnelSteps = [
  { key: "entered", label: "Вход в бот", unit: "контакты бота" },
  { key: "openedChapter", label: "Открыл главу", unit: "аккаунты" },
  { key: "checkout", label: "Перешёл к оплате", unit: "аккаунты" },
  { key: "paid", label: "Оплатил", unit: "аккаунты" },
] as const satisfies readonly {
  readonly key: Exclude<keyof Counts, "consented">;
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
  readonly products: SalesFunnelReport["products"];
  readonly productId: string | null;
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
  /**
   * Согласий на рассылку за период: историческая метрика, не шаг воронки. `null`: бот её не
   * присылает, и отчёт её не показывает.
   */
  readonly historicalConsent: number | null;
  /** Готовый период в днях или `null` для своего периода. */
  readonly preset: SalesFunnelPeriodPreset | null;
  /** `null` — список анкеты ещё не загружен: доли нет, а не ноль купивших. */
  readonly surveyRespondents: SurveyRespondentsView | null;
  readonly notice: string | null;
  readonly waitlist: SalesFunnelReport["waitlist"];
}

/** Итог скидки анкеты по личным ссылкам: только общие числа. */
export interface SurveyRespondentsView {
  readonly uploaded: number;
  readonly issued: number;
  /** `null` — продукт не выбран. */
  readonly paid: number | null;
  /** Доля купивших от получивших ссылку; `null`, когда её не из чего считать. */
  readonly share: {
    /** Например `25 %`. */
    readonly percent: string;
    /** Например `3 из 12`. */
    readonly basis: string;
  } | null;
}

export const correctedPeriodNotice = `Период задан неверно: показаны последние ${String(defaultSalesFunnelPeriodPreset)} дней.`;
const dateSchema = z.iso.date();

/**
 * Период отчёта из параметров адреса: свой период датами включительно по Москве или готовый
 * период в днях, считая сегодня. Неверный свой период заменяется последними тридцатью днями, и
 * страница говорит об этом.
 */
export function readReportPeriod(
  params: {
    readonly from?: string;
    readonly to?: string;
    readonly preset?: SalesFunnelPeriodPreset;
  },
  now: Date,
): {
  readonly from: string;
  readonly to: string;
  readonly query: { readonly from: string; readonly to: string };
  readonly corrected: boolean;
  readonly preset: SalesFunnelPeriodPreset | null;
} {
  const today = moscowDayOf(now);
  const startFor = (days: number) => addMoscowDays(today, -(days - 1));
  const requested =
    params.from === undefined && params.to === undefined
      ? undefined
      : { from: params.from, to: params.to };
  const valid =
    requested !== undefined &&
    dateSchema.safeParse(requested.from).success &&
    dateSchema.safeParse(requested.to).success &&
    (requested.from ?? "") <= (requested.to ?? "");
  const preset =
    requested === undefined
      ? (params.preset ?? defaultSalesFunnelPeriodPreset)
      : valid
        ? null
        : defaultSalesFunnelPeriodPreset;
  const from = preset === null ? (requested?.from ?? today) : startFor(preset);
  const to = preset === null ? (requested?.to ?? today) : today;
  return {
    from,
    to,
    query: {
      from: moscowDayStart(from).toISOString(),
      to: moscowDayStart(addMoscowDays(to, 1)).toISOString(),
    },
    corrected: requested !== undefined && !valid,
    preset,
  };
}

const moscowDateTime = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "long",
  timeStyle: "short",
  timeZone: MOSCOW_TIME_ZONE,
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

const percent = new Intl.NumberFormat("ru-RU", {
  style: "percent",
  maximumFractionDigits: 0,
});

function presentSurveyRespondents(
  respondents: SalesFunnelReport["surveyRespondents"],
): SurveyRespondentsView | null {
  if (respondents === null) return null;
  const { uploaded, issued, paid } = respondents;
  return {
    uploaded,
    issued,
    paid,
    share:
      paid === null || issued === 0
        ? null
        : {
            percent: percent.format(paid / issued),
            basis: `${paid.toLocaleString("ru-RU")} из ${issued.toLocaleString("ru-RU")}`,
          },
  };
}

const countsOf = (counts: Counts): readonly StepCount[] =>
  funnelSteps.map((step) => ({ step: step.key, value: counts[step.key] }));

export function presentSalesFunnelReport(
  report: SalesFunnelReport,
  period: {
    readonly from: string;
    readonly to: string;
    readonly corrected: boolean;
    readonly preset: SalesFunnelPeriodPreset | null;
  },
): SalesFunnelReportView {
  const product = report.products.find(
    (item) => item.id === report.selection?.productId,
  );
  const chapter = product?.chapters.find(
    (item) => item.id === report.selection?.chapterId,
  );
  return {
    waitlist: report.waitlist,
    from: period.from,
    to: period.to,
    products: report.products,
    productId: product?.id ?? null,
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
    historicalConsent: report.total.consented,
    preset: period.preset,
    surveyRespondents: presentSurveyRespondents(report.surveyRespondents),
    notice: period.corrected ? correctedPeriodNotice : null,
  };
}
