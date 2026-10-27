// @ts-check

/**
 * Обзор админки в навигационном наборе (#1719): изолированный HTTP-стенд в форме контракта Nest
 * (`GET /admin/overview` и `GET /admin/products/:productId/overview`), а не проверка прав и
 * агрегатов. Токены выбирают заранее заданные исходы; права, отказы и подсчёт доказывают
 * интеграционные тесты backend.
 *
 * - `Bearer overview-materials`: автор только материалов. Продажи, доступ, воронка и обучение
 *   закрыты правом, сдачи видны; Обзор продукта отвечает 403.
 * - `Bearer overview-clear`: всё проверено, ничего не найдено.
 * - `Bearer overview-forbidden`: аккаунт без обоих прав, 403.
 * - Любой другой токен видит Обзор владельца. Числа зависят от периода, поэтому смена периода
 *   видна на странице: за 7 дней 3 продажи, за 30 дней 10, за 90 дней 30.
 */

export const overviewFixture = Object.freeze({
  product: {
    id: "79000000-0000-4000-8000-000000000301",
    name: "AI Engineering: агенты в работе",
  },
  secondProduct: {
    id: "79000000-0000-4000-8000-000000000302",
    name: "Архитектура приложения",
  },
  person: {
    accountId: "d1210000-0000-4000-8000-000000000001",
    name: "Анна Петрова",
    username: "anna_petrova",
  },
});

const lastDay = Date.UTC(2026, 9, 24);
const dayMs = 86_400_000;

/** @param {number} ms */
function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** @param {number} ms */
function moscowStart(ms) {
  return new Date(ms - 3 * 3_600_000).toISOString();
}

/** @param {7 | 30 | 90} days */
function period(days) {
  const currentFirst = lastDay - (days - 1) * dayMs;
  const previousFirst = currentFirst - days * dayMs;
  return {
    days,
    timeZone: "Europe/Moscow",
    current: {
      from: moscowStart(currentFirst),
      to: moscowStart(lastDay + dayMs),
      firstDay: isoDay(currentFirst),
      lastDay: isoDay(lastDay),
    },
    previous: {
      from: moscowStart(previousFirst),
      to: moscowStart(currentFirst),
      firstDay: isoDay(previousFirst),
      lastDay: isoDay(currentFirst - dayMs),
    },
  };
}

/**
 * Ряд за период: значение `value` каждый `every`-й день, считая с последнего.
 * @param {7 | 30 | 90} days @param {number} every @param {number} value @param {"current" | "previous"} which
 */
function series(days, every, value, which) {
  const end = which === "current" ? lastDay : lastDay - days * dayMs;
  const daily = Array.from({ length: days }, (_, index) => ({
    date: isoDay(end - (days - 1 - index) * dayMs),
    value: (days - 1 - index) % every === 0 ? value : 0,
  }));
  return { total: daily.reduce((sum, point) => sum + point.value, 0), daily };
}

/** @param {7 | 30 | 90} days @param {number} every @param {number} value @param {number} previousEvery */
function metric(days, every, value, previousEvery) {
  return {
    state: "ready",
    current: series(days, every, value, "current"),
    previous: series(days, previousEvery, value, "previous"),
  };
}

function events() {
  const { product, secondProduct, person } = overviewFixture;
  return [
    {
      kind: "payment_confirmed",
      occurredAt: "2026-10-24T09:00:00.000Z",
      person,
      purchaseRef: "79000000-0000-4000-8000-000000000b01",
      amountKopecks: 1_249_000,
      product,
    },
    {
      kind: "access_issued",
      occurredAt: "2026-10-24T09:00:00.000Z",
      person,
      origin: "purchase",
      product,
    },
    {
      kind: "submission",
      occurredAt: "2026-10-23T15:30:00.000Z",
      person: {
        ...person,
        accountId: "d1210000-0000-4000-8000-000000000002",
        name: null,
        username: "dmitry_k",
      },
      submissionId: "79000000-0000-4000-8000-000000000c01",
      commented: false,
      product: secondProduct,
      taskTitle: "Ревью кода с агентом",
    },
    {
      kind: "access_revoked",
      occurredAt: "2026-10-22T12:00:00.000Z",
      person,
      product: secondProduct,
    },
  ];
}

/** @param {7 | 30 | 90} days */
function ownerOverview(days) {
  return {
    period: period(days),
    metrics: {
      state: "ready",
      revenue: {
        state: "ready",
        current: series(days, 3, 1_249_000, "current"),
        previous: series(days, 5, 1_249_000, "previous"),
      },
      sales: metric(days, 3, 1, 5),
      newAccess: {
        ...metric(days, 2, 1, 3),
        byOrigin: {
          purchase: Math.ceil(days / 3),
          course_activation: Math.ceil(days / 2) - Math.ceil(days / 3),
          manual: 0,
          other: 0,
        },
      },
      newAccounts: metric(days, 1, 2, 1),
      waitlistJoins: metric(days, 7, 1, 7),
    },
    funnel: {
      state: "ready",
      product: overviewFixture.product,
      steps: {
        entered: 40 * days,
        openedChapter: 25 * days,
        checkout: null,
        paid: Math.ceil(days / 3),
      },
    },
    attention: {
      undeterminedPayments: { state: "ready", count: 1 },
      fulfillmentIncomplete: { state: "ready", count: 1 },
      communityFailures: { state: "ready", count: 1 },
      telegramDeliveryFailures: { state: "unavailable" },
      submissionsAwaitingFeedback: { state: "ready", count: 0 },
    },
    events: {
      items: events(),
      payments: "ready",
      access: "ready",
      submissions: "ready",
    },
    learning: {
      state: "ready",
      products: [
        {
          productId: overviewFixture.product.id,
          name: overviewFixture.product.name,
          holders: 148,
          started: 121,
          averageProgress: 0.46,
        },
        {
          productId: overviewFixture.secondProduct.id,
          name: overviewFixture.secondProduct.name,
          holders: 37,
          started: 0,
          averageProgress: null,
        },
      ],
    },
  };
}

/** @param {7 | 30 | 90} days */
function materialsOnlyOverview(days) {
  return {
    ...ownerOverview(days),
    metrics: { state: "forbidden" },
    funnel: { state: "forbidden" },
    attention: {
      undeterminedPayments: { state: "forbidden" },
      fulfillmentIncomplete: { state: "forbidden" },
      communityFailures: { state: "forbidden" },
      telegramDeliveryFailures: { state: "forbidden" },
      submissionsAwaitingFeedback: { state: "ready", count: 2 },
    },
    events: {
      // Без права на людей имя и @username не приходят.
      items: events()
        .filter((event) => event.kind === "submission")
        .map((event) => ({
          ...event,
          person: { ...event.person, name: null, username: null },
        })),
      payments: "forbidden",
      access: "forbidden",
      submissions: "ready",
    },
    learning: { state: "forbidden" },
  };
}

/** @param {7 | 30 | 90} days */
function productOverview(days) {
  return {
    period: period(days),
    holders: {
      state: "ready",
      active: 148,
      byOrigin: { purchase: 121, course_activation: 19, manual: 6, other: 2 },
    },
    revenue: {
      state: "ready",
      current: series(days, 3, 1_249_000, "current"),
      previous: series(days, 5, 1_249_000, "previous"),
    },
    sales: metric(days, 3, 1, 5),
    waitlist: { state: "ready", intake: null },
    learning: {
      state: "ready",
      holders: 148,
      started: 121,
      averageProgress: 0.46,
    },
    events: {
      state: "ready",
      items: events().filter((event) => event.kind !== "submission"),
    },
  };
}

/** @param {string | null} value @returns {7 | 30 | 90} */
function days(value) {
  return value === "7" ? 7 : value === "90" ? 90 : 30;
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @returns {{status: number, value: unknown} | null}
 */
export function authoringOverviewRoute(request, url) {
  const product = /^\/admin\/products\/([^/]+)\/overview$/u.exec(url.pathname);
  if (url.pathname !== "/admin/overview" && product === null) return null;
  if (request.method !== "GET") return null;
  const token = request.headers.authorization;
  if (token === undefined)
    return { status: 401, value: { code: "invalid_proof" } };
  const forbidden = {
    status: 403,
    value: {
      code: "forbidden",
      status: 403,
      title: "forbidden",
      type: "urn:inside:problem:forbidden",
    },
  };
  if (token === "Bearer overview-forbidden") return forbidden;
  const period = days(url.searchParams.get("period"));
  if (product !== null)
    return token === "Bearer overview-materials"
      ? forbidden
      : { status: 200, value: productOverview(period) };
  if (token === "Bearer overview-materials")
    return { status: 200, value: materialsOnlyOverview(period) };
  if (token === "Bearer overview-clear")
    return {
      status: 200,
      value: {
        ...ownerOverview(period),
        attention: {
          undeterminedPayments: { state: "ready", count: 0 },
          fulfillmentIncomplete: { state: "ready", count: 0 },
          communityFailures: { state: "ready", count: 0 },
          telegramDeliveryFailures: { state: "ready", count: 0 },
          submissionsAwaitingFeedback: { state: "ready", count: 0 },
        },
      },
    };
  return { status: 200, value: ownerOverview(period) };
}
