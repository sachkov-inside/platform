import {
  formatCountRu,
  formatMoscowShortDay,
  formatRubles,
  type RussianPluralForms,
} from "@/shared/lib/moscow-format";
import type { MetricChange } from "@/shared/ui/admin";

import type {
  OverviewByOrigin,
  OverviewOrigin,
  OverviewPeriodDays,
  OverviewSeries,
} from "./overview-contract";

/** Показатели Обзора; порядок карточек тот же. */
export const overviewMetricIds = [
  "revenue",
  "sales",
  "newAccess",
  "newAccounts",
  "waitlistJoins",
] as const;
export type OverviewMetricId = (typeof overviewMetricIds)[number];

/** Выручка по умолчанию стоит на графике первой. */
export const defaultOverviewMetric: OverviewMetricId = "revenue";

interface MetricDefinition {
  readonly label: string;
  /** Формы слова для изменения и описания графика; у выручки их нет, она в рублях. */
  readonly forms: RussianPluralForms | null;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
}

/**
 * Подписи показателей. «Новые аккаунты» по формулировке спецификации #1717: Обзор считает
 * созданные аккаунты, а не людей из списка «Люди», куда попадают только аккаунты со связью.
 */
export const overviewMetrics: Readonly<
  Record<OverviewMetricId, MetricDefinition>
> = {
  revenue: {
    label: "Выручка за вычетом возвратов",
    forms: null,
    emptyTitle: "За период нет оплат",
    emptyDescription:
      "График появится, когда в этом или прошлом периоде будут оплаты.",
  },
  sales: {
    label: "Продажи",
    forms: ["продажа", "продажи", "продаж"],
    emptyTitle: "За период нет продаж",
    emptyDescription:
      "График появится, когда в этом или прошлом периоде будут продажи.",
  },
  newAccess: {
    label: "Новые доступы",
    forms: ["доступ", "доступа", "доступов"],
    emptyTitle: "За период доступов не выдано",
    emptyDescription:
      "Здесь будут покупки, активации курса и выдачи владельцем по дням.",
  },
  newAccounts: {
    label: "Новые аккаунты",
    forms: ["аккаунт", "аккаунта", "аккаунтов"],
    emptyTitle: "За период новых аккаунтов нет",
    emptyDescription: "График появится, когда кто-нибудь зарегистрируется.",
  },
  waitlistJoins: {
    label: "Записи в списки ожидания",
    forms: ["запись", "записи", "записей"],
    emptyTitle: "За период записей в ожидание нет",
    emptyDescription:
      "График появится, когда кто-нибудь запишется в список ожидания.",
  },
};

const countFormat = new Intl.NumberFormat("ru-RU");
const minus = "−";

/** Число без слова: «1 234». */
export function formatCount(value: number): string {
  return countFormat.format(value);
}

/** Копейки → целые рубли: Обзор показывает суммы без копеек. */
function wholeRubles(kopecks: number): number {
  return Math.round(kopecks / 100);
}

/** Значение карточки: «148 700 ₽» или «31». */
export function metricValueText(id: OverviewMetricId, value: number): string {
  if (overviewMetrics[id].forms === null)
    return formatRubles(wholeRubles(value) * 100);
  return countFormat.format(value);
}

/** Значение со словом для описаний: «148 700 ₽», «31 продажа». */
export function metricAmountText(id: OverviewMetricId, value: number): string {
  const forms = overviewMetrics[id].forms;
  return forms === null
    ? formatRubles(wholeRubles(value) * 100)
    : formatCountRu(value, forms);
}

/** Прошлый период пуст: ни одного события ни в один день. */
function isEmptySeries(series: OverviewSeries): boolean {
  return series.total === 0 && series.daily.every((point) => point.value === 0);
}

/**
 * Изменение к прошлому такому же периоду числом, а не процентом: «+2 продажи», «−1 продажа»,
 * «+12 400 ₽», «без изменений». Пустой прошлый период сравнения не дает: «нет данных». Рост любого
 * показателя Обзора хорош, спад плох; знак и стрелка дублируют цвет.
 */
export function metricChange(
  id: OverviewMetricId,
  current: OverviewSeries,
  previous: OverviewSeries,
): MetricChange {
  if (isEmptySeries(previous)) return { kind: "no_data" };
  const forms = overviewMetrics[id].forms;
  const difference =
    forms === null
      ? wholeRubles(current.total) - wholeRubles(previous.total)
      : current.total - previous.total;
  if (difference === 0)
    return {
      kind: "delta",
      text: "без изменений",
      direction: "flat",
      meaning: "neutral",
    };
  const sign = difference > 0 ? "+" : minus;
  const size = Math.abs(difference);
  return {
    kind: "delta",
    text:
      forms === null
        ? `${sign}${formatRubles(size * 100)}`
        : `${sign}${formatCountRu(size, forms)}`,
    direction: difference > 0 ? "up" : "down",
    meaning: difference > 0 ? "good" : "bad",
  };
}

/** «за 7 дней», «за 30 дней», «за 90 дней». */
export function periodLabel(days: OverviewPeriodDays): string {
  return `за ${formatCountRu(days, ["день", "дня", "дней"])}`;
}

/**
 * Описание графика словами: итог периода, итог прошлого и самый заметный день. Им график
 * читается без картинки.
 */
export function metricChartSummary(
  id: OverviewMetricId,
  days: OverviewPeriodDays,
  current: OverviewSeries,
  previous: OverviewSeries,
): string {
  const head = `${periodLabel(days).replace(/^з/u, "З")}: ${metricAmountText(id, current.total)}`;
  const before = isEmptySeries(previous)
    ? "В прошлом периоде данных нет."
    : `В прошлом периоде: ${metricAmountText(id, previous.total)}.`;
  const peak = current.daily.reduce<OverviewSeries["daily"][number] | null>(
    (best, point) =>
      point.value > 0 && (best === null || point.value > best.value)
        ? point
        : best,
    null,
  );
  const peakText =
    peak === null
      ? ""
      : ` Больше всего ${formatMoscowShortDay(peak.date)}: ${metricAmountText(id, peak.value)}.`;
  return `${head}. ${before}${peakText}`;
}

/** Способы получения доступа по-русски, как в разбивке и в событиях. */
export const overviewOriginLabels: Readonly<Record<OverviewOrigin, string>> = {
  purchase: "Покупка",
  course_activation: "Активация курса",
  manual: "Выдача владельцем",
  other: "Прочее",
};

const originOrder: readonly OverviewOrigin[] = [
  "purchase",
  "course_activation",
  "manual",
  "other",
];

/** Разбивка по способам: только способы, которые были, в постоянном порядке. */
export function originBreakdown(byOrigin: OverviewByOrigin): readonly {
  readonly origin: OverviewOrigin;
  readonly label: string;
  readonly count: number;
}[] {
  return originOrder
    .filter((origin) => byOrigin[origin] > 0)
    .map((origin) => ({
      origin,
      label: overviewOriginLabels[origin],
      count: byOrigin[origin],
    }));
}

/** Средний прогресс 0..1 → «42 %»; без данных → `null`. */
export function progressText(average: number | null): string | null {
  if (average === null) return null;
  return new Intl.NumberFormat("ru-RU", {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(average);
}
