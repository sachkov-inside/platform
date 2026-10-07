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

  test("a bought product opens the community chat, a subscription benefit opens only itself", () => {
    expect(capabilitiesOpenedBy(product)).toEqual([product, "community"]);
    expect(capabilitiesOpenedBy("materials")).toEqual(["materials"]);
    expect(isProductCapability(product)).toBe(true);
    expect(isProductCapability("community")).toBe(false);
  });

  // Витрина называет состав до покупки, сервер выдаёт его после: оба зовут этот вывод, поэтому
  // обещанное и выданное совпадают по построению, а не по совпадению двух описаний.
  test("the composition of a set is the same rule applied to every capability", () => {
    expect(accessComposition([product])).toEqual([product, "community"]);
    expect(accessComposition([product, "community"])).toEqual([
      product,
      "community",
    ]);
    expect(accessComposition(["community", product])).toEqual([
      "community",
      product,
    ]);
    expect(accessComposition(["materials", "support"])).toEqual([
      "materials",
      "support",
      "community",
    ]);
    expect(capabilitiesOpenedBy("support")).toEqual(["support", "community"]);
    expect(accessComposition([])).toEqual([]);
    // Купленное идёт первым, а то, что к нему прилагается, — следом: этот порядок человек читает
    // на витрине, и он не должен зависеть от того, где в наборе стоит право на руководство.
    expect(accessComposition([product, "reviews"])).toEqual([
      product,
      "reviews",
      "community",
    ]);
  });

  test("the composition never repeats a capability the set already names", () => {
    const second = "product:5a1c6f10-0b33-4e2f-9a8c-7d4e12b0f002" as const;
    expect(accessComposition([product, second])).toEqual([
      product,
      second,
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
    ).toEqual([product, second]);
    expect(capabilitiesOpening("community", ["community", product])).toEqual([
      "community",
      product,
    ]);
    expect(capabilitiesOpening("community", ["materials"])).toEqual([]);
    expect(capabilitiesOpening("materials", [product, "materials"])).toEqual([
      "materials",
    ]);
  });
});
