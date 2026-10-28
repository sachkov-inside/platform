import type {
  OverviewAttention,
  OverviewReport,
} from "@/_pages/authoring-overview/model/overview-report";
import type {
  OverviewEvent,
  OverviewPeriod,
  OverviewPeriodDays,
  OverviewSeries,
  ProductOverview,
} from "@/features/admin-overview";

/**
 * Обзор админки для stories и проверок (#1719). Ответы в форме backend: ряды ровно по дням периода,
 * события новые сверху. Данные детерминированы: без случайности и текущих часов, последний день
 * периода 24 октября 2026 года.
 */

export const storyOverviewProducts = [
  {
    id: "97000000-0000-4000-8000-000000000301",
    name: "AI Engineering: агенты в работе",
  },
  {
    id: "97000000-0000-4000-8000-000000000302",
    name: "Архитектура приложения и проектирование распределённых систем",
  },
  { id: "97000000-0000-4000-8000-000000000303", name: "Инженерная практика" },
] as const;

const lastDay = Date.UTC(2026, 9, 24);
const dayMs = 86_400_000;

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Период, который заканчивается 24 октября 2026 года, и прошлый такой же. */
export function storyOverviewPeriod(days: OverviewPeriodDays): OverviewPeriod {
  const currentFirst = lastDay - (days - 1) * dayMs;
  const previousLast = currentFirst - dayMs;
  const previousFirst = previousLast - (days - 1) * dayMs;
  // Полночь по Москве (UTC+3) начала дня.
  const start = (ms: number) => new Date(ms - 3 * 3_600_000).toISOString();
  return {
    days,
    timeZone: "Europe/Moscow",
    current: {
      from: start(currentFirst),
      to: start(lastDay + dayMs),
      firstDay: isoDay(currentFirst),
      lastDay: isoDay(lastDay),
    },
    previous: {
      from: start(previousFirst),
      to: start(currentFirst),
      firstDay: isoDay(previousFirst),
      lastDay: isoDay(previousLast),
    },
  };
}

/**
 * Ряд за период: значения повторяют образец по кругу, последний день — 24 октября (текущий
 * период) или день перед началом текущего (прошлый).
 */
export function storySeries(
  days: OverviewPeriodDays,
  pattern: readonly number[],
  which: "current" | "previous" = "current",
): OverviewSeries {
  const end = which === "current" ? lastDay : lastDay - days * dayMs;
  const daily = Array.from({ length: days }, (_, index) => ({
    date: isoDay(end - (days - 1 - index) * dayMs),
    value: pattern.length === 0 ? 0 : (pattern[index % pattern.length] ?? 0),
  }));
  return {
    total: daily.reduce((sum, point) => sum + point.value, 0),
    daily,
  };
}

function metric(
  days: OverviewPeriodDays,
  current: readonly number[],
  previous: readonly number[],
) {
  return {
    state: "ready" as const,
    current: storySeries(days, current),
    previous: storySeries(days, previous, "previous"),
  };
}

const people = [
  {
    accountId: "97000000-0000-4000-8000-0000000000a1",
    name: "Анна Петрова",
    username: "anna_petrova",
  },
  {
    accountId: "97000000-0000-4000-8000-0000000000a2",
    name: null,
    username: "dmitry_k",
  },
  {
    accountId: "97000000-0000-4000-8000-0000000000a3",
    name: "Константин Константинопольский-Воскресенский",
    username: "konstantin_long_username_example",
  },
  {
    accountId: "97000000-0000-4000-8000-0000000000a4",
    name: null,
    username: null,
  },
] as const;

function personAt(index: number) {
  const person = people[index % people.length] ?? people[0];
  return { ...person };
}

function at(hoursAgo: number): string {
  return new Date(
    lastDay + 11 * 3_600_000 - hoursAgo * 3_600_000,
  ).toISOString();
}

const [agents, architecture, practice] = storyOverviewProducts;

/** Десять событий всех видов, новые сверху. */
export function storyOverviewEvents(): OverviewEvent[] {
  return [
    {
      kind: "payment_confirmed",
      occurredAt: at(0),
      person: personAt(0),
      purchaseRef: "97000000-0000-4000-8000-000000000b01",
      amountKopecks: 1_249_000,
      product: { ...agents },
    },
    {
      kind: "access_issued",
      occurredAt: at(0),
      person: personAt(0),
      origin: "purchase",
      product: { ...agents },
    },
    {
      kind: "submission",
      occurredAt: at(2),
      person: personAt(1),
      submissionId: "97000000-0000-4000-8000-000000000c01",
      commented: false,
      product: { ...practice },
      taskTitle: "Ревью кода с агентом: найти три риска в чужом пулл-реквесте",
    },
    {
      kind: "access_revoked",
      occurredAt: at(5),
      person: personAt(2),
      product: { ...architecture },
    },
    {
      kind: "access_issued",
      occurredAt: at(9),
      person: personAt(3),
      origin: "course_activation",
      product: { ...practice },
    },
    {
      kind: "access_restored",
      occurredAt: at(20),
      person: personAt(2),
      product: { ...architecture },
    },
    {
      kind: "submission",
      occurredAt: at(26),
      person: personAt(0),
      submissionId: "97000000-0000-4000-8000-000000000c02",
      commented: true,
      product: { ...agents },
      taskTitle: null,
    },
    {
      kind: "access_issued",
      occurredAt: at(30),
      person: personAt(1),
      origin: "manual",
      product: { ...architecture },
    },
    {
      kind: "payment_confirmed",
      occurredAt: at(49),
      person: personAt(2),
      purchaseRef: "97000000-0000-4000-8000-000000000b02",
      amountKopecks: 4_990_000,
      product: { ...architecture },
    },
    {
      kind: "payment_confirmed",
      occurredAt: at(75),
      person: personAt(3),
      purchaseRef: "97000000-0000-4000-8000-000000000b03",
      amountKopecks: 990_000,
      product: null,
    },
  ];
}

const attentionFound: OverviewAttention = {
  undeterminedPayments: { state: "ready", count: 2 },
  fulfillmentIncomplete: { state: "ready", count: 1 },
  communityFailures: { state: "ready", count: 3 },
  telegramDeliveryFailures: { state: "ready", count: 0 },
  submissionsAwaitingFeedback: { state: "ready", count: 7 },
};

export const storyAttentionAllClear: OverviewAttention = {
  undeterminedPayments: { state: "ready", count: 0 },
  fulfillmentIncomplete: { state: "ready", count: 0 },
  communityFailures: { state: "ready", count: 0 },
  telegramDeliveryFailures: { state: "ready", count: 0 },
  submissionsAwaitingFeedback: { state: "ready", count: 0 },
};

/** Обзор владельца со всеми правами: продажи идут, есть что проверить. */
export function storyOverviewReport(
  days: OverviewPeriodDays = 30,
): OverviewReport {
  return {
    period: storyOverviewPeriod(days),
    metrics: {
      state: "ready",
      revenue: metric(
        days,
        [1_249_000, 0, 499_000, 0, 0, 1_249_000, 990_000],
        [990_000, 0, 0, 499_000, 0, 1_249_000, 0],
      ),
      sales: metric(days, [1, 0, 1, 0, 0, 1, 1], [1, 0, 0, 1, 0, 1, 0]),
      newAccess: {
        ...metric(days, [2, 0, 1, 1, 0, 1, 1], [1, 1, 0, 1, 0, 1, 0]),
        byOrigin: purchaseHeavy(days),
      },
      newAccounts: metric(days, [3, 1, 2, 0, 4, 1, 2], [2, 2, 1, 1, 3, 2, 2]),
      waitlistJoins: metric(days, [0, 1, 0, 0, 2, 0, 0], [0, 0, 0, 0, 0, 0, 0]),
    },
    funnel: {
      state: "ready",
      product: { ...agents },
      steps: { entered: 412, openedChapter: 268, checkout: 41, paid: 17 },
    },
    attention: attentionFound,
    events: {
      items: storyOverviewEvents(),
      payments: "ready",
      access: "ready",
      submissions: "ready",
    },
    learning: {
      state: "ready",
      products: [
        {
          productId: agents.id,
          name: agents.name,
          holders: 148,
          started: 121,
          averageProgress: 0.46,
        },
        {
          productId: architecture.id,
          name: architecture.name,
          holders: 37,
          started: 12,
          averageProgress: 0.18,
        },
        {
          productId: practice.id,
          name: practice.name,
          holders: 4,
          started: 0,
          averageProgress: null,
        },
      ],
    },
  };
}

function purchaseHeavy(days: OverviewPeriodDays) {
  const total = storySeries(days, [2, 0, 1, 1, 0, 1, 1]).total;
  const courseActivation = Math.floor(total / 6);
  const manual = Math.floor(total / 8);
  const other = 1;
  return {
    purchase: total - courseActivation - manual - other,
    course_activation: courseActivation,
    manual,
    other,
  };
}

/** Пустой период: ни оплат, ни доступов, ни событий; проверять нечего. */
export function storyOverviewEmpty(): OverviewReport {
  const days = 30;
  const zero = metric(days, [0], [0]);
  return {
    period: storyOverviewPeriod(days),
    metrics: {
      state: "ready",
      revenue: zero,
      sales: zero,
      newAccess: {
        ...zero,
        byOrigin: { purchase: 0, course_activation: 0, manual: 0, other: 0 },
      },
      newAccounts: zero,
      waitlistJoins: zero,
    },
    funnel: {
      state: "ready",
      product: null,
      steps: { entered: null, openedChapter: null, checkout: null, paid: null },
    },
    attention: storyAttentionAllClear,
    events: {
      items: [],
      payments: "ready",
      access: "ready",
      submissions: "ready",
    },
    learning: { state: "ready", products: [] },
  };
}

/** Одна продажа за неделю: в прошлом периоде продаж не было. */
export function storyOverviewOneSale(): OverviewReport {
  const days = 7;
  const one = (value: number) => metric(days, [0, 0, 0, 0, 0, value, 0], [0]);
  const report = storyOverviewReport(days);
  return {
    ...report,
    metrics: {
      state: "ready",
      revenue: one(1_249_000),
      sales: one(1),
      newAccess: {
        ...one(1),
        byOrigin: { purchase: 1, course_activation: 0, manual: 0, other: 0 },
      },
      newAccounts: metric(days, [0, 1, 0, 0, 0, 1, 0], [1, 0, 0, 0, 0, 0, 0]),
      waitlistJoins: metric(days, [0], [0, 0, 1, 0, 0, 0, 0]),
    },
    funnel: {
      state: "ready",
      product: { ...agents },
      steps: { entered: 9, openedChapter: 4, checkout: 1, paid: 1 },
    },
    attention: storyAttentionAllClear,
    events: {
      items: storyOverviewEvents().slice(0, 2),
      payments: "ready",
      access: "ready",
      submissions: "ready",
    },
  };
}

/** Длинные ленты: десять событий с длинными именами и много продуктов в обучении. */
export function storyOverviewLongLists(): OverviewReport {
  const report = storyOverviewReport(90);
  const longPerson = {
    accountId: "97000000-0000-4000-8000-0000000000a5",
    name: "Александра Владимировна Преображенская-Тихомирова",
    username: "alexandra_preobrazhenskaya",
  };
  return {
    ...report,
    events: {
      ...report.events,
      items: storyOverviewEvents().map((event, index) =>
        index % 2 === 0 ? { ...event, person: longPerson } : event,
      ),
    },
    learning: {
      state: "ready",
      products: Array.from({ length: 14 }, (_, index) => ({
        productId: `97000000-0000-4000-8000-${String(400 + index).padStart(12, "0")}`,
        name:
          index % 3 === 0
            ? `Поток ${String(index + 1)}: архитектура приложения и проектирование распределённых систем`
            : `Практикум ${String(index + 1)}`,
        holders: 200 - index * 13,
        started: 150 - index * 11,
        averageProgress: index === 5 ? null : Math.max(0, 0.82 - index * 0.06),
      })),
    },
  };
}

/** Автор только материалов: продажи, доступ, воронка и обучение закрыты правом, сдачи видны. */
export function storyOverviewMaterialsOnly(): OverviewReport {
  const report = storyOverviewReport();
  return {
    ...report,
    metrics: { state: "forbidden" },
    funnel: { state: "forbidden" },
    attention: {
      undeterminedPayments: { state: "forbidden" },
      fulfillmentIncomplete: { state: "forbidden" },
      communityFailures: { state: "forbidden" },
      telegramDeliveryFailures: { state: "forbidden" },
      submissionsAwaitingFeedback: { state: "ready", count: 4 },
    },
    events: {
      items: storyOverviewEvents().filter(
        (event) => event.kind === "submission",
      ),
      payments: "forbidden",
      access: "forbidden",
      submissions: "ready",
    },
    learning: { state: "forbidden" },
  };
}

/** Источники не ответили: блоки говорят об этом, а не показывают ноль. */
export function storyOverviewUnavailable(): OverviewReport {
  const report = storyOverviewReport();
  if (report.metrics.state !== "ready") throw new Error("Ready fixture");
  return {
    ...report,
    metrics: {
      ...report.metrics,
      revenue: { state: "unavailable" },
      newAccess: { state: "unavailable" },
    },
    funnel: { state: "unavailable" },
    attention: {
      ...storyAttentionAllClear,
      undeterminedPayments: { state: "unavailable" },
      telegramDeliveryFailures: { state: "unavailable" },
    },
    events: {
      items: storyOverviewEvents().filter(
        (event) => event.kind === "submission",
      ),
      payments: "unavailable",
      access: "unavailable",
      submissions: "ready",
    },
    learning: { state: "unavailable" },
  };
}

/** Всё проверено, ничего не найдено. */
export function storyOverviewAllClear(): OverviewReport {
  return { ...storyOverviewReport(), attention: storyAttentionAllClear };
}

/** Обзор продукта «AI Engineering» за период. */
export function storyProductOverview(
  days: OverviewPeriodDays = 30,
): ProductOverview {
  return {
    period: storyOverviewPeriod(days),
    holders: {
      state: "ready",
      active: 148,
      byOrigin: { purchase: 121, course_activation: 19, manual: 6, other: 2 },
    },
    revenue: metric(
      days,
      [1_249_000, 0, 0, 1_249_000, 0],
      [1_249_000, 0, 0, 0, 0],
    ),
    sales: metric(days, [1, 0, 0, 1, 0], [1, 0, 0, 0, 0]),
    waitlist: {
      state: "ready",
      intake: { name: "Поток весна 2027", active: 23 },
    },
    learning: {
      state: "ready",
      holders: 148,
      started: 121,
      averageProgress: 0.46,
    },
    events: {
      state: "ready",
      items: storyOverviewEvents().filter(
        (event) =>
          event.kind !== "submission" &&
          (event.product === null || event.product.id === agents.id),
      ),
    },
  };
}

/** Новый продукт: обладателей и продаж нет, набор не открыт. */
export function storyProductOverviewEmpty(): ProductOverview {
  const days = 30;
  return {
    period: storyOverviewPeriod(days),
    holders: {
      state: "ready",
      active: 0,
      byOrigin: { purchase: 0, course_activation: 0, manual: 0, other: 0 },
    },
    revenue: metric(days, [0], [0]),
    sales: metric(days, [0], [0]),
    waitlist: { state: "ready", intake: null },
    learning: { state: "ready", holders: 0, started: 0, averageProgress: null },
    events: { state: "ready", items: [] },
  };
}

/** Источники продукта не ответили. */
export function storyProductOverviewUnavailable(): ProductOverview {
  return {
    period: storyOverviewPeriod(30),
    holders: { state: "unavailable" },
    revenue: { state: "unavailable" },
    sales: { state: "unavailable" },
    waitlist: { state: "unavailable" },
    learning: { state: "unavailable" },
    events: { state: "unavailable" },
  };
}
