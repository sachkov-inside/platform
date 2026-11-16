// @ts-check

/** Product identities and deliberate short/long labels for owner payment scenarios. */
export const paymentScenario = /** @type {const} */ ({
  products: [
    {
      key: "ai",
      name: "AI Engineering: от промпта до продакшна",
      shortName: "AI Engineering",
    },
    {
      key: "agents",
      name: "Разработка с агентами",
      shortName: "Разработка с агентами",
    },
    {
      key: "architecture",
      name: "Архитектура и проектирование систем",
      shortName: "Архитектура и проектирование систем",
    },
    {
      key: "testing",
      name: "Тестирование через поведение",
      shortName: "Тестирование через поведение",
    },
    {
      key: "review",
      name: "Код-ревью с агентом: практикум",
      shortName: "Код-ревью с агентом: практикум",
    },
  ],
  storybook: { priceRevision: 3 },
  navigation: { priceRevision: 2, count: 60 },
  orderEmail: "buyer.order@example.test",
  currency: "RUB",
  timezone: "Europe/Moscow",
  offer: {
    revision: 1,
    benefits: ["materials"],
    archived: false,
    published: true,
  },
  option: { revision: 1, mode: "one_time", months: 12, archived: false },
});

export const navigationPaymentProducts = [
  paymentScenario.products[1],
  paymentScenario.products[2],
  paymentScenario.products[0],
];

const storyStates = /** @type {const} */ ([
  "confirmed",
  "confirmed",
  "pending",
  "unknown",
  "failed",
  "confirmed",
  "authorized",
  "sent",
]);
const navigationStates = /** @type {const} */ ([
  "confirmed",
  "pending",
  "failed",
  "confirmed",
  "sent",
]);
const storyPrices = [1_990_000, 4_990_000, 990_000, 2_490_000];
const storyAccesses = /** @type {const} */ ([
  "ready",
  "preparing",
  "review_required",
]);

/**
 * Shared fictional payment facts. The variants preserve two existing state matrices,
 * date windows and amounts; adapters only project them into their own contracts.
 * @param {number} index
 * @param {"storybook" | "navigation"} variant
 */
export function paymentFacts(index, variant) {
  const navigation = variant === "navigation";
  const products = navigation
    ? navigationPaymentProducts
    : paymentScenario.products;
  const product = products[index % products.length];
  if (product === undefined) throw new Error("Unknown scenario Product");
  const state = navigation
    ? index === 0
      ? "unknown"
      : (navigationStates[index % navigationStates.length] ?? "confirmed")
    : (storyStates[index % storyStates.length] ?? "confirmed");
  const amountKopecks = navigation
    ? 990_000 + (index % 4) * 500_000
    : (storyPrices[index % storyPrices.length] ?? 990_000);
  const occurredAt = new Date(
    Date.parse(
      navigation ? "2026-10-24T11:00:00.000Z" : "2026-10-24T11:05:00.000Z",
    ) -
      index * (navigation ? 6 : 5) * 3_600_000,
  ).toISOString();
  const access =
    state === "confirmed"
      ? navigation
        ? index === 3
          ? "preparing"
          : "ready"
        : (storyAccesses[index % storyAccesses.length] ?? "ready")
      : "awaiting_payment";
  return /** @type {const} */ ({
    product,
    amountKopecks,
    state,
    occurredAt,
    access,
    environment: navigation ? "demo" : "production",
    terminalRef: navigation ? "1700000000001DEMO" : "1700000000001",
    priceRevision: navigation
      ? paymentScenario.navigation.priceRevision
      : paymentScenario.storybook.priceRevision,
    bankPaymentId: String((navigation ? 7_200_000_000 : 7_100_000_000) + index),
    refundedKopecks: navigation && state === "unknown" ? null : 0,
    refundableKopecks:
      state === "confirmed"
        ? amountKopecks
        : navigation && state === "unknown"
          ? null
          : 0,
  });
}
