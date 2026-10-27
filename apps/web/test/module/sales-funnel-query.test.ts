import { describe, expect, it } from "vitest";

import {
  hasSalesFunnelSelection,
  parseSalesFunnelQuery,
  withFunnelChapter,
  withFunnelPeriod,
  withFunnelProduct,
} from "@/_pages/sales-funnel-report/model/sales-funnel-query";
import { authoringSalesFunnelAddressHref as salesFunnelHref } from "@/shared/routing/authoring";

const productId = "00000000-0000-4000-8000-000000000816";
const otherProductId = "00000000-0000-4000-8000-000000000820";
const chapterId = "00000000-0000-4000-8000-000000000817";

describe("sales funnel address", () => {
  it("opens without parameters on the server's choice and the last thirty days", () => {
    const query = parseSalesFunnelQuery({});
    expect(query).toEqual({
      productId: null,
      chapterId: null,
      period: { kind: "preset", days: 30 },
    });
    expect(salesFunnelHref(query)).toBe("/authoring/sales/funnel");
    expect(hasSalesFunnelSelection(query)).toBe(false);
  });

  it("round-trips product, chapter and a ready-made period through the address", () => {
    const href = salesFunnelHref(
      withFunnelPeriod(
        withFunnelChapter(parseSalesFunnelQuery({}), productId, chapterId),
        { kind: "preset", days: 7 },
      ),
    );
    expect(href).toBe(
      `/authoring/sales/funnel?productId=${productId}&chapterId=${chapterId}&period=7`,
    );
    const parsed = parseSalesFunnelQuery(
      Object.fromEntries(new URL(href, "https://inside.test").searchParams),
    );
    expect(parsed).toEqual({
      productId,
      chapterId,
      period: { kind: "preset", days: 7 },
    });
  });

  it("keeps the earlier from/to addresses as a custom period", () => {
    const query = parseSalesFunnelQuery({
      from: "2030-03-01",
      to: "2030-03-31",
      period: "7",
    });
    expect(query.period).toEqual({
      kind: "custom",
      from: "2030-03-01",
      to: "2030-03-31",
    });
    expect(salesFunnelHref(query)).toBe(
      "/authoring/sales/funnel?from=2030-03-01&to=2030-03-31",
    );
  });

  it("drops the chapter when the product changes and ignores foreign values", () => {
    const query = parseSalesFunnelQuery({ productId, chapterId });
    expect(withFunnelProduct(query, otherProductId)).toMatchObject({
      productId: otherProductId,
      chapterId: null,
    });
    expect(
      parseSalesFunnelQuery({
        productId: "not-a-uuid",
        chapterId,
        period: "14",
      }),
    ).toEqual({
      productId: null,
      chapterId: null,
      period: { kind: "preset", days: 30 },
    });
  });
});
