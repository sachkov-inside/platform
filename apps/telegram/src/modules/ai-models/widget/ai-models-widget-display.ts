import type {
  AiModelsModel,
  AiModelsPlan,
  AiModelsReference,
  AiModelsSubscription,
} from "../ai-models-reference-file.js";

// The display rules of the ИИ-модели widget: what the bot computes from the Справочник before it
// writes a screen. Мощность and the leaders come from the Arena rank, the price level from the
// task price; money, multiples and dates are formatted here; the filter «Цена/качество», the
// cheapest plan of «Дёшево» and the folding of plan rows in «Подписки» are decided here.
// ai-models-widget-wire.ts writes the results into the screens.

/** Dots of Мощность: ten places of the Arena table per dot, five for the first ten. */
export function aiModelsPower(arenaRank: number): number {
  if (arenaRank <= 10) return 5;
  if (arenaRank <= 20) return 4;
  if (arenaRank <= 30) return 3;
  if (arenaRank <= 40) return 2;
  return 1;
}

/** The two leaders of the Arena table get a coloured last dot. */
export const isAiModelsLeader = (model: AiModelsModel): boolean =>
  model.arenaRank <= 2;

/** Price level 1 to 5 by the price of one task through the API. */
export function aiModelsPriceLevel(taskUsd: number): number {
  if (taskUsd >= 5) return 5;
  if (taskUsd >= 2) return 4;
  if (taskUsd >= 1) return 3;
  if (taskUsd >= 0.3) return 2;
  return 1;
}

const NBSP = " ";

/** "$20", "$19,99", "$0,30", "$1 234,50": whole dollars without cents, otherwise two digits. */
export function aiModelsUsd(usd: number): string {
  const [whole = "", cents] = (
    Number.isInteger(usd) ? String(usd) : usd.toFixed(2)
  ).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `$${grouped}${cents === undefined ? "" : `,${cents}`}`;
}

/** An estimate in round money: whole dollars below $100, tens below $1 000, hundreds above. */
export function aiModelsEstimateUsd(usd: number): string {
  const step = usd < 100 ? 1 : usd < 1000 ? 10 : 100;
  const rounded = Math.round(usd / step) * step;
  // $99,6 rounds to $100, which is written like the other round hundreds.
  return aiModelsUsd(rounded);
}

/** The Оценка подписки: "≈ $670" by measurement, "$100" for a limit the vendor states in dollars. */
export function aiModelsEstimate(
  estimate: NonNullable<AiModelsSubscription["estimate"]>,
): string {
  return (
    (estimate.basis === "measured" ? `≈${NBSP}` : "") +
    aiModelsEstimateUsd(estimate.apiUsdPerMonth)
  );
}

/**
 * How many times the estimate exceeds the price, with «раз» or «раза»: whole from 10, with one
 * decimal below it. Empty when it is not above the price after rounding.
 */
export function aiModelsMultiple(ratio: number): string {
  const value = ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10;
  if (value <= 1) return "";
  if (!Number.isInteger(value))
    return `${String(value).replace(".", ",")} раза`;
  const lastTwo = value % 100;
  const last = value % 10;
  const few = last >= 2 && last <= 4 && !(lastTwo >= 12 && lastTwo <= 14);
  return `${String(value)} ${few ? "раза" : "раз"}`;
}

/** «ДД.ММ» of an ISO date. */
export const aiModelsShortDate = (isoDate: string): string => {
  const [, month, day] = isoDate.split("-");
  return `${day ?? ""}.${month ?? ""}`;
};

/** «ДД.ММ.ГГГГ» of an ISO date. */
export const aiModelsFullDate = (isoDate: string): string => {
  const [year, month, day] = isoDate.split("-");
  return `${day ?? ""}.${month ?? ""}.${year ?? ""}`;
};

/** Models by their place in Arena, the strongest first. */
export const aiModelsByRank = (
  models: readonly AiModelsModel[],
): AiModelsModel[] => [...models].sort((a, b) => a.arenaRank - b.arenaRank);

/** Models by the price of one task, the cheapest first; equal prices by Arena. */
export const aiModelsByTaskPrice = (
  models: readonly AiModelsModel[],
): AiModelsModel[] =>
  [...models].sort((a, b) =>
    a.taskUsd === b.taskUsd ? a.arenaRank - b.arenaRank : a.taskUsd - b.taskUsd,
  );

/**
 * «Цена/качество»: models without another model that is both higher in Arena and cheaper per
 * task, the cheapest first.
 */
export function aiModelsValueModels(
  reference: AiModelsReference,
): AiModelsModel[] {
  return aiModelsByTaskPrice(
    reference.models.filter(
      (model) =>
        !reference.models.some(
          (other) =>
            other.arenaRank < model.arenaRank && other.taskUsd < model.taskUsd,
        ),
    ),
  );
}

/** The cheapest plan with the model that is not a promo; undefined when the model is API only. */
export function aiModelsCheapestPlan(
  reference: AiModelsReference,
  model: AiModelsModel,
): number | undefined {
  const prices = model.subscriptions
    .filter(({ promo }) => promo !== true)
    .flatMap(({ plan }) => {
      const found = reference.plans.find(({ code }) => code === plan);
      return found ? [found.usdPerMonth] : [];
    });
  return prices.length > 0 ? Math.min(...prices) : undefined;
}

/** A row of «Подписки» before it is written: the plans it covers and its subscription. */
export interface AiModelsPlanLine {
  readonly plans: AiModelsPlan[];
  readonly subscription: AiModelsSubscription;
}

/** Neighbouring plans fold when only their names and prices differ: the same vendor words. */
const folds = (line: AiModelsPlanLine, next: AiModelsSubscription): boolean =>
  line.subscription.vendorWording !== undefined &&
  line.subscription.vendorWording === next.vendorWording &&
  line.subscription.note === next.note &&
  (line.subscription.promo ?? false) === (next.promo ?? false);

/**
 * The rows of «Подписки» by service code, services and rows in the order of the model's
 * subscriptions; neighbouring plans of one service fold into one row.
 */
export function aiModelsPlanLines(
  reference: AiModelsReference,
  model: AiModelsModel,
): Map<string, AiModelsPlanLine[]> {
  const groups = new Map<string, AiModelsPlanLine[]>();
  for (const subscription of model.subscriptions) {
    const plan = reference.plans.find(({ code }) => code === subscription.plan);
    if (plan === undefined) continue;
    const lines = groups.get(plan.service) ?? [];
    groups.set(plan.service, lines);
    const last = lines.at(-1);
    if (last !== undefined && folds(last, subscription)) last.plans.push(plan);
    else lines.push({ plans: [plan], subscription });
  }
  return groups;
}
