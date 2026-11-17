export const salesCatalogueScenario: {
  readonly storyPriceRevision: number;
  readonly respondentUsernames: readonly [string, string, string, string];
  readonly firstRespondentIssuedAt: string;
  readonly linkCreatedEpoch: string;
  readonly actionCreatedEpoch: string;
  readonly generated: {
    readonly count: number;
    readonly firstIndex: number;
    readonly firstPriceKopecks: number;
    readonly priceStepKopecks: number;
    readonly storyLabel: string;
    readonly navigationLabel: string;
    readonly navigationRevision: number;
  };
};
export function salesProductFacts(channel: "story" | "navigation"): {
  index: number;
  name: string;
  priceKopecks: number;
  priceRevision: number;
}[];

export type SalesPromotionKey = "autumn" | "alumni" | "tribute";
export function salesPromotionFact(
  key: SalesPromotionKey,
  channel: "story" | "navigation",
): {
  index: number;
  revision: number;
  name: string;
  percent: number;
  code: string | null;
  startsAt: string;
  endsAt: string;
  productIndexes: number[];
  usageLimit: number | null;
  archived: boolean;
  usedCount: number;
  questionnaire: boolean;
  legacy: boolean;
};
