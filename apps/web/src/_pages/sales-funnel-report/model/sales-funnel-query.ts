import { z } from "zod";

import {
  defaultSalesFunnelPeriodPreset,
  salesFunnelParams,
  salesFunnelPeriodPresets,
  serializeSalesFunnelAddress,
  type SalesFunnelAddress,
  type SalesFunnelPeriod,
  type SalesFunnelPeriodPreset,
} from "@/shared/routing/authoring";

/**
 * Готовые периоды, период по умолчанию и кодировщик адреса отчёта принадлежат
 * `@/shared/routing/authoring`: туда же ведут ссылки на отчёт из Обзора. Здесь разбор адреса и
 * изменения выбора на странице отчёта.
 */

type SearchValue = string | readonly string[] | undefined;
export type SalesFunnelSearchParams = Readonly<Record<string, SearchValue>>;

const idSchema = z.uuid();
const dateSchema = z.iso.date();
const presetSchema = z.coerce
  .number()
  .pipe(z.union(salesFunnelPeriodPresets.map((days) => z.literal(days))));

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
): SalesFunnelAddress {
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
  const period: SalesFunnelPeriod =
    from !== undefined || to !== undefined
      ? { kind: "custom", from: from ?? "", to: to ?? "" }
      : { kind: "preset", days: preset ?? defaultSalesFunnelPeriodPreset };
  return {
    productId: productId ?? null,
    chapterId: chapterId ?? null,
    period,
  };
}

/** Другой продукт: глава прежнего продукта ему не принадлежит, сервер возьмёт первую. */
export function withFunnelProduct(
  query: SalesFunnelAddress,
  productId: string,
): SalesFunnelAddress {
  return { ...query, productId, chapterId: null };
}

export function withFunnelChapter(
  query: SalesFunnelAddress,
  productId: string,
  chapterId: string,
): SalesFunnelAddress {
  return { ...query, productId, chapterId };
}

export function withFunnelPeriod(
  query: SalesFunnelAddress,
  period: SalesFunnelPeriod,
): SalesFunnelAddress {
  return { ...query, period };
}

/** Период и выбор отличаются от того, что отчёт показывает без параметров. */
export function hasSalesFunnelSelection(query: SalesFunnelAddress): boolean {
  return serializeSalesFunnelAddress(query) !== "";
}

/** Период для чтения отчёта: свой период проверяет `readReportPeriod`. */
export function periodParams(period: SalesFunnelPeriod):
  | { readonly preset: SalesFunnelPeriodPreset }
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
