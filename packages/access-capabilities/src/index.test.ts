import { describe, expect, test } from "vitest";

import {
  accessCapabilitySchema,
  accessComposition,
  capabilitiesOpenedBy,
  globalAccessCapabilities,
  guideCapability,
  isGuideCapability,
} from "./index.js";

const guide = "guide:5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f001" as const;

describe("access capabilities", () => {
  test("the vocabulary accepts its own words and refuses the rest", () => {
    for (const capability of globalAccessCapabilities) {
      expect(accessCapabilitySchema.safeParse(capability).success).toBe(true);
    }
    expect(accessCapabilitySchema.safeParse(guide).success).toBe(true);
    expect(accessCapabilitySchema.safeParse("guide:not-a-uuid").success).toBe(false);
    expect(accessCapabilitySchema.safeParse("chat").success).toBe(false);
  });

  test("a built guide capability is one the vocabulary reads back", () => {
    const built = guideCapability("5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f001");
    expect(built).toBe(guide);
    expect(accessCapabilitySchema.safeParse(built).success).toBe(true);
    expect(isGuideCapability(built)).toBe(true);
  });

  test("a bought guide opens the community chat, a subscription benefit opens only itself", () => {
    expect(capabilitiesOpenedBy(guide)).toEqual([guide, "community"]);
    expect(capabilitiesOpenedBy("materials")).toEqual(["materials"]);
    expect(isGuideCapability(guide)).toBe(true);
    expect(isGuideCapability("community")).toBe(false);
  });

  // Витрина называет состав до покупки, сервер выдаёт его после: оба зовут этот вывод, поэтому
  // обещанное и выданное совпадают по построению, а не по совпадению двух описаний.
  test("the composition of a set is the same rule applied to every capability", () => {
    expect(accessComposition([guide])).toEqual([guide, "community"]);
    expect(accessComposition([guide, "community"])).toEqual([guide, "community"]);
    expect(accessComposition(["community", guide])).toEqual(["community", guide]);
    expect(accessComposition(["materials", "support"])).toEqual(["materials", "support"]);
    expect(accessComposition([])).toEqual([]);
    // Купленное идёт первым, а то, что к нему прилагается, — следом: этот порядок человек читает
    // на витрине, и он не должен зависеть от того, где в наборе стоит право на руководство.
    expect(accessComposition([guide, "reviews"])).toEqual([guide, "reviews", "community"]);
  });

  test("the composition never repeats a capability the set already names", () => {
    const second = "guide:5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f002" as const;
    expect(accessComposition([guide, second])).toEqual([guide, second, "community"]);
  });
});
