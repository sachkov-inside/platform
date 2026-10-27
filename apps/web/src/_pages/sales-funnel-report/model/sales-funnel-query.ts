import type { Route } from "next";
import { z } from "zod";

/** Адрес отчёта в разделе «Продажи». */
export const salesFunnelRootHref = "/authoring/sales/funnel";

/** Готовые периоды в днях, считая сегодняшний день по Москве. Тридцать дней идут по умолчанию. */
export const funnelPeriodPresets = [7, 30, 90] as const;
export type FunnelPeriodPreset = (typeof funnelPeriodPresets)[number];
export const defaultFunnelPeriodPreset: FunnelPeriodPreset = 30;

export type FunnelPeriod =
  | { readonly kind: "preset"; readonly days: FunnelPeriodPreset }
  /** Даты по Москве включительно, `YYYY-MM-DD`. */
  | { readonly kind: "custom"; readonly from: string; readonly to: string };

/**
 * Состояние отчёта в адресе: продукт, глава и период. `null` у продукта и главы значит выбор
 * сервера (первый продукт и его первая глава).
 */
export interface SalesFunnelQuery {
  readonly productId: string | null;
  readonly chapterId: string | null;
  readonly period: FunnelPeriod;
}

type SearchValue = string | readonly string[] | undefined;
export type SalesFunnelSearchParams = Readonly<Record<string, SearchValue>>;

const idSchema = z.uuid();
const dateSchema = z.iso.date();
const presetSchema = z.coerce
  .number()
  .pipe(z.union(funnelPeriodPresets.map((days) => z.literal(days))));

function single(value: SearchValue): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Параметры адреса → состояние отчёта. Свой период (`from`, `to`) важнее готового (`period`):
 * так открываются и прежние ссылки на отчёт. Неверная дата остаётся в состоянии как есть, а
 * сервер заменяет такой период последними тридцатью днями и говорит об этом.
 */
export function parseSalesFunnelQuery(
  params: SalesFunnelSearchParams,
): SalesFunnelQuery {
  const productId = idSchema.safeParse(single(params["productId"])).data;
  const chapterId =
    productId === undefined
      ? undefined
      : idSchema.safeParse(single(params["chapterId"])).data;
  const from = single(params["from"]);
  const to = single(params["to"]);
  const preset = presetSchema.safeParse(single(params["period"])).data;
  const period: FunnelPeriod =
    from !== undefined || to !== undefined
      ? { kind: "custom", from: from ?? "", to: to ?? "" }
      : { kind: "preset", days: preset ?? defaultFunnelPeriodPreset };
  return {
    productId: productId ?? null,
    chapterId: chapterId ?? null,
    period,
  };
}

export function serializeSalesFunnelQuery(query: SalesFunnelQuery): string {
  const params = new URLSearchParams();
  if (query.productId !== null) params.set("productId", query.productId);
  if (query.productId !== null && query.chapterId !== null)
    params.set("chapterId", query.chapterId);
  if (query.period.kind === "custom") {
    params.set("from", query.period.from);
    params.set("to", query.period.to);
  } else if (query.period.days !== defaultFunnelPeriodPreset)
    params.set("period", String(query.period.days));
  return params.toString();
}

export function salesFunnelHref(query: SalesFunnelQuery): Route {
  const serialized = serializeSalesFunnelQuery(query);
  return serialized === ""
    ? salesFunnelRootHref
    : `${salesFunnelRootHref}?${serialized}`;
}

/** Другой продукт: глава прежнего продукта ему не принадлежит, сервер возьмёт первую. */
export function withFunnelProduct(
  query: SalesFunnelQuery,
  productId: string,
): SalesFunnelQuery {
  return { ...query, productId, chapterId: null };
}

export function withFunnelChapter(
  query: SalesFunnelQuery,
  productId: string,
  chapterId: string,
): SalesFunnelQuery {
  return { ...query, productId, chapterId };
}

export function withFunnelPeriod(
  query: SalesFunnelQuery,
  period: FunnelPeriod,
): SalesFunnelQuery {
  return { ...query, period };
}

/** Период и выбор отличаются от того, что отчёт показывает без параметров. */
export function hasSalesFunnelSelection(query: SalesFunnelQuery): boolean {
  return serializeSalesFunnelQuery(query) !== "";
}

/** Период для чтения отчёта: свой период проверяет `readReportPeriod`. */
export function periodParams(period: FunnelPeriod):
  | { readonly preset: FunnelPeriodPreset }
  | {
      readonly from: string;
      readonly to: string;
    } {
  return period.kind === "preset"
    ? { preset: period.days }
    : { from: period.from, to: period.to };
}

/** Даты своего периода как календарные дни, если обе верны и идут по порядку. */
export function isValidCustomPeriod(from: string, to: string): boolean {
  return (
    dateSchema.safeParse(from).success &&
    dateSchema.safeParse(to).success &&
    from <= to
  );
}
