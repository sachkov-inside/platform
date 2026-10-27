import { z } from "zod";

import {
  authoringSalesFunnelAddressHref,
  authoringSalesFunnelHref,
  defaultSalesFunnelPeriodPreset,
  salesFunnelParams,
  salesFunnelPeriodPresets,
  serializeSalesFunnelAddress,
  type SalesFunnelAddress,
  type SalesFunnelPeriod,
  type SalesFunnelPeriodPreset,
} from "@/shared/routing/authoring";

/** Адрес отчёта в разделе «Продажи». */
export const salesFunnelRootHref = authoringSalesFunnelHref;

/**
 * Готовые периоды, период по умолчанию и кодировщик адреса принадлежат
 * `@/shared/routing/authoring`: туда же ведут ссылки на отчёт из Обзора.
 */
export const funnelPeriodPresets = salesFunnelPeriodPresets;
export type FunnelPeriodPreset = SalesFunnelPeriodPreset;
export const defaultFunnelPeriodPreset = defaultSalesFunnelPeriodPreset;
export type FunnelPeriod = SalesFunnelPeriod;
/** Состояние отчёта в адресе: продукт, глава и период. */
export type SalesFunnelQuery = SalesFunnelAddress;

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
  const productId = idSchema.safeParse(
    single(params[salesFunnelParams.productId]),
  ).data;
  const chapterId =
    productId === undefined
      ? undefined
      : idSchema.safeParse(single(params[salesFunnelParams.chapterId])).data;
  const from = single(params[salesFunnelParams.from]);
  const to = single(params[salesFunnelParams.to]);
  const preset = presetSchema.safeParse(
    single(params[salesFunnelParams.period]),
  ).data;
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

export const serializeSalesFunnelQuery = serializeSalesFunnelAddress;

export const salesFunnelHref = authoringSalesFunnelAddressHref;

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
