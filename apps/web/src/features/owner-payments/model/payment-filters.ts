import type { Route } from "next";
import { z } from "zod";

import { attemptStateSchema } from "@/entities/subscription";
import { addMoscowDays, moscowDayStart } from "@/shared/lib/moscow-day";
import { formatMoscowDate } from "@/shared/lib/moscow-format";
import { authoringPaymentsHref } from "@/shared/routing/authoring";

/** Банковское состояние попытки оплаты: закрытый список владельца billing. */
export type PaymentState = z.infer<typeof attemptStateSchema>;
export const paymentStates: readonly PaymentState[] =
  attemptStateSchema.options;

/**
 * Что выбрано в списке платежей. Адрес страницы хранит это целиком, поэтому ссылка и «назад»
 * возвращают тот же срез. Даты — московские календарные дни включительно, как их вводит человек;
 * в мгновения `[from, to)` их переводит только запрос.
 */
export interface PaymentsQuery {
  /** Пусто — любые состояния. Порядок канонический, без повторов. */
  readonly states: readonly PaymentState[];
  readonly productId?: string;
  /** «YYYY-MM-DD», первый день периода. */
  readonly from?: string;
  /** «YYYY-MM-DD», последний день периода. */
  readonly to?: string;
  /**
   * `incomplete`: подтверждённые оплаты, выдача которых ещё не завершена. Список открывается с ним
   * из «Требует внимания» Обзора (#1719).
   */
  readonly fulfillment?: PaymentFulfillmentFilter;
  /** Позиция продолжения из ответа backend, а не номер страницы. */
  readonly cursor?: string;
}

export const emptyPaymentsQuery: PaymentsQuery = { states: [] };

const fulfillmentSchema = z.literal("incomplete");
export type PaymentFulfillmentFilter = z.infer<typeof fulfillmentSchema>;
export const fulfillmentFilterLabel = "Выдача не завершена";
export const salesPaymentsHref = authoringPaymentsHref;

/** Сколько строк просит одна страница списка. */
export const paymentsPageSize = 50;

const daySchema = z.iso.date();
const uuidSchema = z.uuid();

/** Адрес списка → выбор. Неверные значения отбрасываются, а не превращаются в ошибку страницы. */
export function parsePaymentsSearchParams(
  params: URLSearchParams,
): PaymentsQuery {
  const requested = new Set(
    params
      .getAll("state")
      .flatMap((value) => attemptStateSchema.safeParse(value).data ?? []),
  );
  const productId = uuidSchema.safeParse(params.get("product")).data;
  const from = daySchema.safeParse(params.get("from")).data;
  const parsedTo = daySchema.safeParse(params.get("to")).data;
  // Конец раньше начала не задаёт периода: остаётся только начало, и поле конца пустеет.
  const to =
    parsedTo !== undefined && from !== undefined && parsedTo < from
      ? undefined
      : parsedTo;
  const cursor = uuidSchema.safeParse(params.get("cursor")).data;
  const fulfillment = fulfillmentSchema.safeParse(
    params.get("fulfillment"),
  ).data;
  return {
    states: paymentStates.filter((state) => requested.has(state)),
    ...(productId === undefined ? {} : { productId }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(fulfillment === undefined ? {} : { fulfillment }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export function serializePaymentsQuery(query: PaymentsQuery): string {
  const params = new URLSearchParams();
  for (const state of query.states) params.append("state", state);
  if (query.productId !== undefined) params.set("product", query.productId);
  if (query.from !== undefined) params.set("from", query.from);
  if (query.to !== undefined) params.set("to", query.to);
  if (query.fulfillment !== undefined)
    params.set("fulfillment", query.fulfillment);
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  return params.toString();
}

/** Адрес страницы платежей с этим выбором. */
export function salesPaymentsQueryHref(query: PaymentsQuery): Route {
  const search = serializePaymentsQuery(query);
  return search === "" ? salesPaymentsHref : `${salesPaymentsHref}?${search}`;
}

/** Состояние, продукт, период или выдача сужают список; позиция продолжения сама по себе нет. */
export function hasPaymentsFilters(query: PaymentsQuery): boolean {
  return (
    query.states.length > 0 ||
    query.productId !== undefined ||
    query.from !== undefined ||
    query.to !== undefined ||
    query.fulfillment !== undefined
  );
}

export type PaymentsFilterChange =
  | { readonly key: "states"; readonly value: readonly PaymentState[] }
  | { readonly key: "productId"; readonly value: string | undefined }
  | { readonly key: "from"; readonly value: string | undefined }
  | { readonly key: "to"; readonly value: string | undefined }
  | { readonly key: "period"; readonly value: undefined }
  | { readonly key: "fulfillment"; readonly value: undefined };

/**
 * Выбор после одного изменения фильтра. Любое изменение возвращает к началу списка: прежняя
 * позиция продолжения принадлежит другому срезу.
 */
export function withPaymentsFilter(
  query: PaymentsQuery,
  change: PaymentsFilterChange,
): PaymentsQuery {
  const { cursor: _cursor, ...rest } = query;
  switch (change.key) {
    case "states": {
      const chosen = new Set(change.value);
      return {
        ...rest,
        states: paymentStates.filter((state) => chosen.has(state)),
      };
    }
    case "productId": {
      const { productId: _productId, ...withoutProduct } = rest;
      const productId = uuidSchema.safeParse(change.value).data;
      return productId === undefined
        ? withoutProduct
        : { ...withoutProduct, productId };
    }
    case "from":
    case "to": {
      const { [change.key]: _removed, ...withoutDay } = rest;
      const day = daySchema.safeParse(change.value).data;
      return day === undefined
        ? withoutDay
        : { ...withoutDay, [change.key]: day };
    }
    case "period": {
      const { from: _from, to: _to, ...withoutPeriod } = rest;
      return withoutPeriod;
    }
    case "fulfillment": {
      const { fulfillment: _fulfillment, ...withoutFulfillment } = rest;
      return withoutFulfillment;
    }
  }
}

/** Следующая страница того же среза. */
export function withPaymentsCursor(
  query: PaymentsQuery,
  cursor: string | undefined,
): PaymentsQuery {
  const { cursor: _cursor, ...rest } = query;
  return cursor === undefined ? rest : { ...rest, cursor };
}

/** Начало суток, следующих за днём: правая граница `[from, to)` для последнего дня периода. */
function moscowDayAfter(day: string): string {
  return moscowDayStart(addMoscowDays(day, 1)).toISOString();
}

/** Чтение списка, которое уходит в `payments.list` владельца billing. */
export interface PaymentsListRequest {
  readonly limit: number;
  readonly accountId?: string;
  readonly states?: readonly PaymentState[];
  readonly productId?: string;
  /** Мгновение ISO, включительно. */
  readonly from?: string;
  /** Мгновение ISO, исключительно. */
  readonly to?: string;
  readonly fulfillment?: PaymentFulfillmentFilter;
  readonly cursor?: string;
}

/** Выбор страницы → запрос: московские дни становятся полуоткрытым промежутком мгновений. */
export function paymentsListRequest(
  query: PaymentsQuery,
  accountId?: string,
): PaymentsListRequest {
  return {
    limit: paymentsPageSize,
    ...(accountId === undefined ? {} : { accountId }),
    ...(query.states.length === 0 ? {} : { states: query.states }),
    ...(query.productId === undefined ? {} : { productId: query.productId }),
    ...(query.from === undefined
      ? {}
      : { from: moscowDayStart(query.from).toISOString() }),
    ...(query.to === undefined ? {} : { to: moscowDayAfter(query.to) }),
    ...(query.fulfillment === undefined
      ? {}
      : { fulfillment: query.fulfillment }),
    ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  };
}

/** Тот же запрос в адресе BFF: повторяемые `state`, остальное по одному значению. */
export function serializePaymentsListRequest(
  request: PaymentsListRequest,
): string {
  const params = new URLSearchParams();
  params.set("limit", String(request.limit));
  if (request.accountId !== undefined)
    params.set("accountId", request.accountId);
  for (const state of request.states ?? []) params.append("state", state);
  if (request.productId !== undefined)
    params.set("productId", request.productId);
  if (request.from !== undefined) params.set("from", request.from);
  if (request.to !== undefined) params.set("to", request.to);
  if (request.fulfillment !== undefined)
    params.set("fulfillment", request.fulfillment);
  if (request.cursor !== undefined) params.set("cursor", request.cursor);
  return params.toString();
}

const instantSchema = z.iso.datetime({ offset: true });

/** Адрес BFF → запрос к backend. `null` — запрос вне схемы, BFF отвечает отказом без вызова. */
export function parsePaymentsListRequest(
  params: URLSearchParams,
): PaymentsListRequest | null {
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .safeParse(params.get("limit") ?? paymentsPageSize);
  const states = params
    .getAll("state")
    .map((value) => attemptStateSchema.safeParse(value));
  const optional = <Schema extends z.ZodType<string>>(
    name: string,
    schema: Schema,
  ) => {
    const value = params.get(name);
    if (value === null) return { ok: true as const, value: undefined };
    const parsed = schema.safeParse(value);
    return parsed.success
      ? { ok: true as const, value: parsed.data }
      : { ok: false as const };
  };
  const accountId = optional("accountId", uuidSchema);
  const productId = optional("productId", uuidSchema);
  const from = optional("from", instantSchema);
  const to = optional("to", instantSchema);
  const fulfillment = optional("fulfillment", fulfillmentSchema);
  const cursor = optional("cursor", uuidSchema);
  if (
    !limit.success ||
    states.some((state) => !state.success) ||
    !accountId.ok ||
    !productId.ok ||
    !from.ok ||
    !to.ok ||
    !fulfillment.ok ||
    !cursor.ok
  )
    return null;
  const chosen = new Set(states.flatMap((state) => state.data ?? []));
  return {
    limit: limit.data,
    ...(accountId.value === undefined ? {} : { accountId: accountId.value }),
    ...(chosen.size === 0
      ? {}
      : { states: paymentStates.filter((state) => chosen.has(state)) }),
    ...(productId.value === undefined ? {} : { productId: productId.value }),
    ...(from.value === undefined ? {} : { from: from.value }),
    ...(to.value === undefined ? {} : { to: to.value }),
    ...(fulfillment.value === undefined
      ? {}
      : { fulfillment: fulfillment.value }),
    ...(cursor.value === undefined ? {} : { cursor: cursor.value }),
  };
}

/** «С 1 окт. 2026 по 20 окт. 2026», «С 1 окт. 2026», «По 20 окт. 2026». */
export function paymentsPeriodLabel(query: PaymentsQuery): string | undefined {
  if (query.from !== undefined && query.to !== undefined)
    return query.from === query.to
      ? formatMoscowDate(query.from)
      : `С ${formatMoscowDate(query.from)} по ${formatMoscowDate(query.to)}`;
  if (query.from !== undefined) return `С ${formatMoscowDate(query.from)}`;
  if (query.to !== undefined) return `По ${formatMoscowDate(query.to)}`;
  return undefined;
}
