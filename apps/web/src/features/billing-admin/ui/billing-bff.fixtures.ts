import { fn } from "storybook/test";

import { getQueryClient } from "@/shared/api/query-client";
import { fetchBeforeRender } from "@/storybook/mutation-mock";

/**
 * Подмена владельческого BFF billing для историй страниц «Оплата и права» и «Доступ». Панели
 * production читают и пишут через `/api/authoring/billing/<маршрут>` и сами разбирают ответ, поэтому
 * история задаёт только тела ответов: состояние на экране выбирает production-код.
 */

const billingPrefix = "/api/authoring/billing/";
const operationRef = "00000000-0000-4000-8000-0000000000aa";
const pending = Symbol("pending");
const transportStatus = Symbol("transport-status");

/** Ответ маршрута: тело, сбой транспорта с кодом HTTP или запрос без ответа. */
type BillingReply =
  | typeof pending
  | { readonly [transportStatus]: number }
  | Readonly<Record<string, unknown>>;

/** Ответ маршрута либо функция от входа команды, когда ответ зависит от него. */
export type BillingRoutes = Readonly<
  Record<string, BillingReply | ((input: unknown) => BillingReply)>
>;

/** Каждая команда и каждое чтение панели: маршрут без префикса и вход из поля `input`. */
export const billingRequests = fn(
  (_route: string, _input: unknown): void => undefined,
);

/** Успешный исход в конверте владельческой команды. */
export function billingOk(result: Readonly<Record<string, unknown>>) {
  return { ok: true, value: { operationRef, result } } as const;
}

/** Закрытый отказ billing: панель называет его словами владельца. */
export function billingRefused(code: string) {
  return { ok: false, code } as const;
}

/** Маршрут не ответил: чтение остаётся в состоянии загрузки, команда — в состоянии отправки. */
export const billingNeverAnswers: BillingReply = pending;

/** Сбой транспорта: BFF вернул HTTP-ошибку вместо исхода. */
export function billingHttpStatus(status: number): BillingReply {
  return { [transportStatus]: status };
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(
    input instanceof Request ? input.url : input,
    window.location.origin,
  );
}

function routeOf(input: RequestInfo | URL): string | null {
  const url = requestUrl(input);
  return url.pathname.startsWith(billingPrefix)
    ? url.pathname.slice(billingPrefix.length)
    : null;
}

function commandInput(init: RequestInit | undefined): unknown {
  const body = init?.body;
  if (!(body instanceof FormData)) return undefined;
  const raw = body.get("input");
  return typeof raw === "string" ? (JSON.parse(raw) as unknown) : undefined;
}

function billingFetch(routes: BillingRoutes) {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const route = routeOf(input);
    if (route === null || !(route in routes)) {
      return Promise.reject(
        new Error(
          `Story has no billing reply for ${requestUrl(input).pathname}`,
        ),
      );
    }
    const payload = commandInput(init);
    billingRequests(route, payload);
    const configured = routes[route];
    const reply =
      typeof configured === "function" ? configured(payload) : configured;
    if (reply === pending || reply === undefined) {
      return new Promise<Response>(() => undefined);
    }
    if (transportStatus in reply) {
      return Promise.resolve(
        new Response(null, { status: reply[transportStatus] }),
      );
    }
    return Promise.resolve(Response.json(reply));
  };
}

/**
 * `beforeEach` истории: ставит ответы BFF до первого рендера и начинает с пустого кэша чтений.
 * Кэш приложения общий для всех историй, поэтому без сброса страница показала бы данные
 * предыдущей истории. Повторы чтений выключены: отказ виден сразу, а не после трёх попыток.
 */
export function billingBeforeRender(routes: BillingRoutes) {
  return () => {
    const client = getQueryClient();
    const defaults = client.getDefaultOptions();
    client.clear();
    client.setDefaultOptions({
      ...defaults,
      queries: { ...defaults.queries, retry: false },
    });
    billingRequests.mockClear();
    const restoreFetch = fetchBeforeRender(billingFetch(routes))();
    return () => {
      restoreFetch();
      client.clear();
      client.setDefaultOptions(defaults);
    };
  };
}
