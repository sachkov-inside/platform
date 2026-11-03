import { describe, expect, it } from "vitest";
import { loadCommunityDiscussionsConfig } from "../../src/config/community-discussions-config.js";

describe("community discussion budget settings", () => {
  it("requires an explicit unlimited value to remove the monthly cap", () => {
    expect(
      loadCommunityDiscussionsConfig({
        TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED: "true",
        COMMUNITY_DISCUSSIONS_MONTHLY_LIMIT_MICRO_USD: "unlimited",
      })?.budget.monthlyLimitMicroUsd,
    ).toBeNull();
    expect(
      loadCommunityDiscussionsConfig({
        TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED: "true",
      })?.budget.monthlyLimitMicroUsd,
    ).toBe(0);
  });
  it("loads a zero monthly limit as a deliberate pause with positive fallback costs", () => {
    const config = loadCommunityDiscussionsConfig({
      TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED: "true",
      COMMUNITY_DISCUSSIONS_MONTHLY_LIMIT_MICRO_USD: "0",
      COMMUNITY_DISCUSSIONS_GROUPING_FALLBACK_MICRO_USD: "12500",
    });
    expect(config?.budget).toMatchObject({
      monthlyLimitMicroUsd: 0,
      groupingFallbackMicroUsd: 12500,
    });
  });
  it.each(["-1", "0.5", "NaN", "Infinity", "null", "9007199254740992", ""])(
    "rejects an invalid monthly limit %j",
    (limit) => {
      expect(() =>
        loadCommunityDiscussionsConfig({
          TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED: "true",
          COMMUNITY_DISCUSSIONS_MONTHLY_LIMIT_MICRO_USD: limit,
        }),
      ).toThrow("MONTHLY_LIMIT_MICRO_USD");
    },
  );
  it("requires discussion capture before accepting budget settings", () => {
    expect(() =>
      loadCommunityDiscussionsConfig({
        COMMUNITY_DISCUSSIONS_MONTHLY_LIMIT_MICRO_USD: "10000",
      }),
    ).toThrow("TELEGRAM_COMMUNITY_DISCUSSIONS_ENABLED");
  });
});
