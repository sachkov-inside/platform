// @ts-check
const namedProducts = [
  {
    index: 1,
    name: "AI Engineering",
    priceKopecks: 2_990_000,
    navigationRevision: 3,
  },
  {
    index: 2,
    name: "Агентная разработка",
    storyName: "Агентная разработка: от первого агента до команды агентов",
    priceKopecks: 1_990_000,
    navigationRevision: 1,
  },
  {
    index: 3,
    name: "Архитектура систем",
    priceKopecks: 3_900_000,
    navigationRevision: 2,
  },
];
export const salesCatalogueScenario = {
  storyPriceRevision: 2,
  respondentUsernames: [
    "anna_dev",
    "kirill_codes",
    "olga_qa",
    "maxim_platform_engineering",
  ],
  firstRespondentIssuedAt: "2026-05-12T09:00:00.000Z",
  linkCreatedEpoch: "2026-10-26T09:00:00.000Z",
  actionCreatedEpoch: "2026-10-27T09:00:00.000Z",
  generated: {
    count: 22,
    firstIndex: 11,
    firstPriceKopecks: 990_000,
    priceStepKopecks: 10_000,
    storyLabel: "Практикум по инженерии",
    navigationLabel: "Практикум",
    navigationRevision: 1,
  },
};

/** @param {"story" | "navigation"} channel */
export function salesProductFacts(channel) {
  const generated = salesCatalogueScenario.generated;
  return [
    ...namedProducts.map((product) => ({
      index: product.index,
      name:
        channel === "story"
          ? (product.storyName ?? product.name)
          : product.name,
      priceKopecks: product.priceKopecks,
      priceRevision:
        channel === "story"
          ? salesCatalogueScenario.storyPriceRevision
          : product.navigationRevision,
    })),
    ...Array.from({ length: generated.count }, (_, index) => ({
      index: generated.firstIndex + index,
      name: `${channel === "story" ? generated.storyLabel : generated.navigationLabel} ${String(index + 1).padStart(2, "0")}`,
      priceKopecks:
        generated.firstPriceKopecks + index * generated.priceStepKopecks,
      priceRevision:
        channel === "story"
          ? salesCatalogueScenario.storyPriceRevision
          : generated.navigationRevision,
    })),
  ];
}

/** Different fixtures exercise different wire values; sharing must retain both variants (#2334). */
const promotionCases = {
  autumn: {
    common: {
      index: 1,
      revision: 3,
      percent: 20,
      code: "AUTUMN",
      usageLimit: 50,
      archived: false,
      usedCount: 12,
      questionnaire: false,
      legacy: false,
    },
    story: {
      name: "Осенняя скидка на AI Engineering и агентную разработку",
      startsAt: "2026-09-30T21:00:00.000Z",
      endsAt: "2098-12-31T21:00:00.000Z",
    },
    navigation: {
      name: "Осенняя скидка на AI Engineering",
      startsAt: "2026-10-01T00:00:00+03:00",
      endsAt: "2099-01-01T00:00:00+03:00",
    },
    productIndexes: {
      story: [0, 1, 2],
      navigation: [0, 1],
    },
  },
  alumni: {
    common: {
      index: 2,
      revision: 1,
      name: "Скидка выпускникам",
      percent: 10,
      code: null,
      usageLimit: null,
      archived: false,
      questionnaire: false,
      legacy: false,
    },
    story: {
      startsAt: "2026-08-31T21:00:00.000Z",
      endsAt: "2098-12-31T21:00:00.000Z",
      usedCount: 1240,
    },
    navigation: {
      startsAt: "2026-09-01T00:00:00+03:00",
      endsAt: "2099-01-01T00:00:00+03:00",
      usedCount: 140,
    },
    productIndexes: {
      story: [],
      navigation: [],
    },
  },
  tribute: {
    common: {
      revision: 2,
      name: "Скидка подписчикам Tribute",
      percent: 30,
      code: null,
      usageLimit: null,
      archived: true,
      usedCount: 61,
      questionnaire: false,
      legacy: true,
    },
    story: {
      index: 11,
      startsAt: "2024-12-31T21:00:00.000Z",
      endsAt: "2025-02-28T21:00:00.000Z",
    },
    navigation: {
      index: 3,
      startsAt: "2025-01-01T00:00:00+03:00",
      endsAt: "2025-03-01T00:00:00+03:00",
    },
    productIndexes: {
      story: [],
      navigation: [],
    },
  },
};

/** @param {"autumn" | "alumni" | "tribute"} key @param {"story" | "navigation"} channel */
export function salesPromotionFact(key, channel) {
  const scenario = promotionCases[key];
  return {
    ...scenario.common,
    ...scenario[channel],
    productIndexes: [...scenario.productIndexes[channel]],
  };
}
