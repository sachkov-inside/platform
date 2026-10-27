import type { Route } from "next";
import { z } from "zod";

import {
  newAccessMetricSchema,
  overviewEventSchema,
  overviewMetricSchema,
  overviewPeriodSchema,
  type OverviewPeriodDays,
} from "@/features/admin-overview";
import { salesPaymentsQueryHref } from "@/features/owner-payments";
import { formatCountRu } from "@/shared/lib/moscow-format";
import {
  authoringPeopleTelegramHref,
  authoringProductEditorHref,
  authoringSalesFunnelProductHref,
  authoringSubmissionsHref,
} from "@/shared/routing/authoring";

/**
 * Обзор админки (#1719), `GET admin/overview?period=`. Каждый блок отвечает сам за себя: `forbidden`
 * значит, что у аккаунта нет права на его факты, `unavailable` значит, что источник не ответил.
 * Ни то ни другое не читается как ноль или «всё в порядке».
 */
const forbidden = z.strictObject({ state: z.literal("forbidden") });
const unavailable = z.strictObject({ state: z.literal("unavailable") });

const metricsSchema = z.discriminatedUnion("state", [
  forbidden,
  z.strictObject({
    state: z.literal("ready"),
    revenue: overviewMetricSchema,
    sales: overviewMetricSchema,
    newAccess: newAccessMetricSchema,
    newAccounts: overviewMetricSchema,
    waitlistJoins: overviewMetricSchema,
  }),
]);

const funnelStep = z.int().nonnegative().nullable();

const funnelSchema = z.discriminatedUnion("state", [
  forbidden,
  unavailable,
  z.strictObject({
    state: z.literal("ready"),
    product: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
    steps: z.strictObject({
      entered: funnelStep,
      openedChapter: funnelStep,
      checkout: funnelStep,
      paid: funnelStep,
    }),
  }),
]);

const attentionItemSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("ready"), count: z.int().nonnegative() }),
  forbidden,
  unavailable,
]);
export type AttentionItem = z.infer<typeof attentionItemSchema>;

const attentionSchema = z.strictObject({
  undeterminedPayments: attentionItemSchema,
  fulfillmentIncomplete: attentionItemSchema,
  communityFailures: attentionItemSchema,
  telegramDeliveryFailures: attentionItemSchema,
  submissionsAwaitingFeedback: attentionItemSchema,
});
export type OverviewAttention = z.infer<typeof attentionSchema>;

const sourceState = z.enum(["ready", "forbidden", "unavailable"]);

const eventsSchema = z.strictObject({
  items: z.array(overviewEventSchema).max(10),
  payments: sourceState,
  access: sourceState,
  submissions: sourceState,
});

const learningSchema = z.discriminatedUnion("state", [
  forbidden,
  unavailable,
  z.strictObject({
    state: z.literal("ready"),
    products: z.array(
      z.strictObject({
        productId: z.uuid(),
        name: z.string(),
        holders: z.int().nonnegative(),
        started: z.int().nonnegative(),
        averageProgress: z.number().min(0).max(1).nullable(),
      }),
    ),
  }),
]);

export const overviewReportSchema = z.strictObject({
  period: overviewPeriodSchema,
  metrics: metricsSchema,
  funnel: funnelSchema,
  attention: attentionSchema,
  events: eventsSchema,
  learning: learningSchema,
});
export type OverviewReport = z.infer<typeof overviewReportSchema>;
export type OverviewFunnel = OverviewReport["funnel"];
export type OverviewEvents = OverviewReport["events"];
export type OverviewLearning = OverviewReport["learning"];

/** Чтение Обзора так, как его видит страница. Отказ всей страницы не пустой Обзор. */
export type OverviewState =
  | ({ readonly kind: "ready" } & OverviewReport)
  | { readonly kind: "signed_out" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable"; readonly reference: string };

export const overviewStateSchema: z.ZodType<OverviewState> = z.union([
  overviewReportSchema.extend({ kind: z.literal("ready") }),
  z.strictObject({ kind: z.literal("signed_out") }),
  z.strictObject({ kind: z.literal("forbidden") }),
  z.strictObject({ kind: z.literal("unavailable"), reference: z.string() }),
]);

/** Ключ чтения Обзора за период. */
export function overviewQueryKey(period: OverviewPeriodDays) {
  return ["authoring", "overview", period] as const;
}

/* «Требует внимания». */

export type AttentionId = keyof OverviewAttention;

/** Право, без которого проверка скрыта, простыми словами. */
type AttentionRight = "billing" | "submissions";

interface AttentionDefinition {
  readonly label: string;
  readonly unchecked: string;
  readonly href: Route;
  readonly right: AttentionRight;
}

/**
 * Проверки «Требует внимания» в порядке показа. Каждая ведет в уже отфильтрованный список. Сбои
 * Telegram считаются людьми; доставка считается неподтверждённой, если сообщение не дошло за
 * последние 30 дней или итог его отправки неизвестен.
 */
export const attentionDefinitions: Readonly<
  Record<AttentionId, AttentionDefinition>
> = {
  undeterminedPayments: {
    label: "Оплаты с неизвестным итогом",
    unchecked: "Не удалось проверить оплаты с неизвестным итогом",
    href: salesPaymentsQueryHref({ states: ["unknown", "authorized"] }),
    right: "billing",
  },
  fulfillmentIncomplete: {
    label: "Оплачено, но выдача не завершена",
    unchecked: "Не удалось проверить выдачу после оплаты",
    href: salesPaymentsQueryHref({
      states: ["confirmed"],
      fulfillment: "incomplete",
    }),
    right: "billing",
  },
  communityFailures: {
    label: "Сбой доступа к группе Telegram",
    unchecked: "Не удалось проверить доступ к группам Telegram",
    href: authoringPeopleTelegramHref("community_failed"),
    right: "billing",
  },
  telegramDeliveryFailures: {
    label: "Доставка сообщений Telegram не подтверждена",
    unchecked: "Не удалось проверить доставку сообщений Telegram",
    href: authoringPeopleTelegramHref("delivery_failed"),
    right: "billing",
  },
  submissionsAwaitingFeedback: {
    label: "Сдачи без комментария",
    unchecked: "Не удалось проверить сдачи без комментария",
    href: authoringSubmissionsHref,
    right: "submissions",
  },
};

const attentionIds: readonly AttentionId[] = [
  "undeterminedPayments",
  "fulfillmentIncomplete",
  "communityFailures",
  "telegramDeliveryFailures",
  "submissionsAwaitingFeedback",
];

/** Кого считает строка: оплаты, люди или сдачи. */
const attentionUnits: Readonly<
  Record<AttentionId, readonly [string, string, string]>
> = {
  undeterminedPayments: ["оплата", "оплаты", "оплат"],
  fulfillmentIncomplete: ["оплата", "оплаты", "оплат"],
  communityFailures: ["человек", "человека", "человек"],
  telegramDeliveryFailures: ["человек", "человека", "человек"],
  submissionsAwaitingFeedback: ["сдача", "сдачи", "сдач"],
};

export type AttentionRow =
  | {
      readonly id: AttentionId;
      readonly kind: "count";
      readonly label: string;
      readonly count: number;
      /** «3 оплаты», «1 человек»: для доступного имени ссылки. */
      readonly countText: string;
      readonly href: Route;
    }
  | {
      readonly id: AttentionId;
      readonly kind: "unchecked";
      readonly label: string;
    };

export type AttentionView =
  /** Все проверки скрыты правами: блок говорит, какое право их открывает. */
  | { readonly kind: "forbidden" }
  /** Все видимые проверки прошли и ничего не нашли. */
  | { readonly kind: "all_clear"; readonly hiddenNote: string | null }
  | {
      readonly kind: "rows";
      readonly rows: readonly AttentionRow[];
      readonly hiddenNote: string | null;
    };

const rightNotes: Readonly<Record<AttentionRight, string>> = {
  billing:
    "Оплаты, выдачу и Telegram проверяет аккаунт с правом управлять доступом и оплатами.",
  submissions: "Сдачи проверяет аккаунт с правом управлять материалами.",
};

/**
 * Строки «Требует внимания»: только проверки с находками и проверки, которые не удалось выполнить.
 * Непроверенное не сворачивается в «Всё в порядке». Скрытые правами проверки не показываются, а
 * одна тихая строка называет право, которое их открывает.
 */
export function attentionView(attention: OverviewAttention): AttentionView {
  const visible = attentionIds.filter(
    (id) => attention[id].state !== "forbidden",
  );
  if (visible.length === 0) return { kind: "forbidden" };
  const hiddenRights = new Set(
    attentionIds
      .filter((id) => attention[id].state === "forbidden")
      .map((id) => attentionDefinitions[id].right),
  );
  const hiddenNote =
    hiddenRights.size === 0
      ? null
      : (["billing", "submissions"] as const)
          .filter((right) => hiddenRights.has(right))
          .map((right) => rightNotes[right])
          .join(" ");
  const rows = visible.flatMap((id): AttentionRow[] => {
    const item = attention[id];
    const definition = attentionDefinitions[id];
    if (item.state === "unavailable")
      return [{ id, kind: "unchecked", label: definition.unchecked }];
    if (item.state !== "ready" || item.count === 0) return [];
    return [
      {
        id,
        kind: "count",
        label: definition.label,
        count: item.count,
        countText: formatCountRu(item.count, attentionUnits[id]),
        href: definition.href,
      },
    ];
  });
  return rows.length === 0
    ? { kind: "all_clear", hiddenNote }
    : { kind: "rows", rows, hiddenNote };
}

/* Воронка. */

export const funnelStepLabels = {
  entered: "Вход в бот",
  openedChapter: "Открыл главу",
  checkout: "Перешёл к оплате",
  paid: "Оплатил",
} as const;

export type FunnelStepId = keyof typeof funnelStepLabels;

export interface FunnelStepRow {
  readonly id: FunnelStepId;
  readonly label: string;
  /** `null`: шаг не считается для этого продукта. */
  readonly count: number | null;
  /** Доля от самого большого шага, 0..1, для полосы. */
  readonly share: number;
}

export function funnelStepRows(
  steps: Readonly<Record<FunnelStepId, number | null>>,
): readonly FunnelStepRow[] {
  const ids: readonly FunnelStepId[] = [
    "entered",
    "openedChapter",
    "checkout",
    "paid",
  ];
  const top = Math.max(0, ...ids.map((id) => steps[id] ?? 0));
  return ids.map((id) => {
    const count = steps[id];
    return {
      id,
      label: funnelStepLabels[id],
      count,
      share: count === null || top === 0 ? 0 : count / top,
    };
  });
}

/** Полный отчет воронки за тот же период и продукт. */
export function fullFunnelHref(
  productId: string,
  period: OverviewPeriodDays,
): Route {
  return authoringSalesFunnelProductHref(productId, period);
}

/** Обучение по продукту открывает «Учеников» страницы продукта. */
export function productLearnersHref(productId: string): Route {
  return authoringProductEditorHref(productId, "learners");
}

/**
 * Карточка человека открыта зрителю, если ему видны оплаты или доступы: оба чтения требуют того же
 * права, что и карточка.
 */
export function canOpenPeople(events: OverviewEvents): boolean {
  return events.payments !== "forbidden" || events.access !== "forbidden";
}
