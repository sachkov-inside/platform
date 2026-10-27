import { z } from "zod";

import {
  defaultOverviewPeriod,
  overviewByOriginSchema,
  overviewEventSchema,
  overviewMetricSchema,
  overviewPeriodSchema,
  parseOverviewPeriod,
  type OverviewPeriodDays,
} from "./overview-contract";

/**
 * Обзор одного продукта (#1719), `GET admin/products/:productId/overview?period=`: обладатели по
 * способу получения, выручка и продажи за период, список ожидания текущего набора, обучение и
 * последние события продукта. Только для аккаунта с правом управлять доступом и оплатами.
 */
const unavailable = z.strictObject({ state: z.literal("unavailable") });

export const productOverviewSchema = z.strictObject({
  period: overviewPeriodSchema,
  holders: z.discriminatedUnion("state", [
    unavailable,
    z.strictObject({
      state: z.literal("ready"),
      active: z.int().nonnegative(),
      byOrigin: overviewByOriginSchema,
    }),
  ]),
  revenue: overviewMetricSchema,
  sales: overviewMetricSchema,
  waitlist: z.discriminatedUnion("state", [
    unavailable,
    z.strictObject({
      state: z.literal("ready"),
      intake: z
        .strictObject({ name: z.string(), active: z.int().nonnegative() })
        .nullable(),
    }),
  ]),
  learning: z.discriminatedUnion("state", [
    unavailable,
    z.strictObject({
      state: z.literal("ready"),
      holders: z.int().nonnegative(),
      started: z.int().nonnegative(),
      averageProgress: z.number().min(0).max(1).nullable(),
    }),
  ]),
  events: z.discriminatedUnion("state", [
    unavailable,
    z.strictObject({
      state: z.literal("ready"),
      items: z.array(overviewEventSchema),
    }),
  ]),
});
export type ProductOverview = z.infer<typeof productOverviewSchema>;

export type ProductOverviewState =
  | ({ readonly kind: "ready" } & ProductOverview)
  | { readonly kind: "signed_out" }
  /** Аккаунт без права управлять доступом и оплатами, например автор только материалов. */
  | { readonly kind: "forbidden" }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable"; readonly reference: string };

export const productOverviewStateSchema: z.ZodType<ProductOverviewState> =
  z.union([
    productOverviewSchema.extend({ kind: z.literal("ready") }),
    z.strictObject({ kind: z.literal("signed_out") }),
    z.strictObject({ kind: z.literal("forbidden") }),
    z.strictObject({ kind: z.literal("not_found") }),
    z.strictObject({ kind: z.literal("unavailable"), reference: z.string() }),
  ]);

/** Период вкладки живет в адресе страницы продукта: `?period=7|90`, тридцать дней не пишутся. */
export function readProductOverviewPeriod(
  params: URLSearchParams,
): OverviewPeriodDays {
  return parseOverviewPeriod(params.get("period"));
}

/** Строка запроса страницы продукта с этим периодом; вкладка и остальные параметры остаются. */
export function productOverviewPeriodSearch(
  currentSearch: string,
  period: OverviewPeriodDays,
): string {
  const params = new URLSearchParams(currentSearch);
  if (period === defaultOverviewPeriod) params.delete("period");
  else params.set("period", String(period));
  const search = params.toString();
  return search === "" ? "" : `?${search}`;
}

export function productOverviewQueryKey(
  productId: string,
  period: OverviewPeriodDays,
) {
  return ["authoring", "product-overview", productId, period] as const;
}
