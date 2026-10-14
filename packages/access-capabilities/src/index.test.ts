import { describe, expect, test } from "vitest";

import {
  accessCapabilitySchema,
  accessComposition,
  capabilitiesOpenedBy,
  capabilitiesOpening,
  globalAccessCapabilities,
  productCapability,
  isEmptyCoverage,
  isProductCapability,
  isWithheldCapability,
  scopeIncludesProduct,
  scopeOpensResource,
} from "./index.js";

const product = "product:5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f001" as const;

describe("access capabilities", () => {
  test("the vocabulary accepts its own words and refuses the rest", () => {
    for (const capability of globalAccessCapabilities) {
      expect(accessCapabilitySchema.safeParse(capability).success).toBe(true);
    }
    expect(accessCapabilitySchema.safeParse(product).success).toBe(true);
    expect(accessCapabilitySchema.safeParse("product:not-a-uuid").success).toBe(
      false,
    );
    expect(accessCapabilitySchema.safeParse("chat").success).toBe(false);
  });

  test("a built product capability is one the vocabulary reads back", () => {
    const built = productCapability("5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f001");
    expect(built).toBe(product);
    expect(accessCapabilitySchema.safeParse(built).success).toBe(true);
    expect(isProductCapability(built)).toBe(true);
  });

  test("a Product and support do not imply community access", () => {
    expect(capabilitiesOpenedBy(product)).toEqual([product]);
    expect(capabilitiesOpenedBy("support")).toEqual(["support"]);
    expect(accessComposition([product, "support"])).toEqual([
      product,
      "support",
    ]);
    expect(accessComposition([product, "community"])).toEqual([
      product,
      "community",
    ]);
  });

  test("a composition without a Product or a Material opens nothing", () => {
    const id = "5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f001";
    expect(isEmptyCoverage(null)).toBe(true);
    expect(isEmptyCoverage(undefined)).toBe(true);
    expect(isEmptyCoverage({ productIds: [], materialIds: [] })).toBe(true);
    expect(
      isEmptyCoverage({ productIds: ["not-a-uuid"], materialIds: [] }),
    ).toBe(true);
    expect(isEmptyCoverage({ productIds: [id], materialIds: [] })).toBe(false);
    expect(isEmptyCoverage({ productIds: [], materialIds: [id] })).toBe(false);
    expect(
      isEmptyCoverage({ productIds: [], materialIds: [], wholePlatform: true }),
    ).toBe(false);
    // Все продукты платформы включают и тот, что появится позже.
    expect(
      scopeIncludesProduct(
        { productIds: [], materialIds: [], wholePlatform: true },
        id,
      ),
    ).toBe(true);
    expect(
      scopeIncludesProduct({ productIds: [id], materialIds: [] }, id),
    ).toBe(true);
    expect(
      scopeIncludesProduct({ productIds: [], materialIds: [id] }, id),
    ).toBe(false);
    expect(
      scopeOpensResource(
        { productIds: [], materialIds: [id] },
        { productIds: [], materialId: id },
      ),
    ).toBe(true);
    expect(
      scopeOpensResource(
        { productIds: [], materialIds: [], wholePlatform: true },
        { productIds: [id] },
      ),
    ).toBe(true);
    expect(
      scopeOpensResource(
        { productIds: [], materialIds: [], wholePlatform: true },
        { productIds: [] },
      ),
    ).toBe(false);
    // «Все продукты» не перечисляет продукты и материалы.
    expect(
      isEmptyCoverage({
        productIds: [id],
        materialIds: [],
        wholePlatform: true,
      }),
    ).toBe(true);
    expect(isWithheldCapability("reviews")).toBe(true);
    expect(isWithheldCapability("support")).toBe(false);
  });

  // Срок участия в чате держится всем, что чат открывает: и объявленным правом участия, и каждым
  // правом на руководство. Спрашивать об этом надо у вывода, иначе правило распадается на копии.
  test("names every capability that opens the one asked about", () => {
    const second = "product:5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f002" as const;
    expect(
      capabilitiesOpening("community", [product, "materials", second]),
    ).toEqual([]);
    expect(capabilitiesOpening("community", ["community", product])).toEqual([
      "community",
    ]);
    expect(capabilitiesOpening("community", ["materials"])).toEqual([]);
    expect(capabilitiesOpening("materials", [product, "materials"])).toEqual([
      "materials",
    ]);
  });
});
