import { z } from "zod";

import type { MutationFetch } from "./mutation-mock";

/**
 * Подставной BFF вкладок «Продажа» и «Сообщество и активация» страницы продукта: те же маршруты и
 * конверты ответов, что у Route Handlers. Состояние живёт внутри одного показа story, поэтому
 * сохранение меняет следующее чтение, а ревизия растёт, как на сервере.
 */

export const saleProductId = "97000000-0000-4000-8000-000000000003";
export const saleProductName = "AI Engineering: от прототипа к продукту";

const operationRef = "97000000-0000-4000-8000-0000000000f1";
const offerId = "97000000-0000-4000-8000-0000000000f2";
const paymentOptionId = "97000000-0000-4000-8000-0000000000f3";

export interface SaleFixturePrice {
  readonly revision: number;
  readonly name: string;
  readonly priceKopecks: number;
  readonly published: boolean;
}

export interface SaleFixtureState {
  readonly productId: string;
  readonly revision: number;
  readonly name: string;
  readonly stage: "announcement" | "preorder" | "running" | "between";
  readonly startsOn: string | null;
  readonly nextEvent: string;
  readonly priceAfterStartKopecks: number | null;
}

export interface ActivationRuleFixture {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly revision: number;
  readonly productId: string;
  readonly sourceRef: string;
  readonly verificationMode: "course_membership";
  readonly published: boolean;
  readonly startsAt: string;
  readonly endsAt: string | null;
}

export const runningPrice: SaleFixturePrice = {
  revision: 4,
  name: saleProductName,
  priceKopecks: 4_990_000,
  published: true,
};

export const runningState: SaleFixtureState = {
  productId: saleProductId,
  revision: 3,
  name: "Второй поток",
  stage: "running",
  startsOn: "2026-11-16",
  nextEvent: "",
  priceAfterStartKopecks: null,
};

export const preorderState: SaleFixtureState = {
  ...runningState,
  stage: "preorder",
  startsOn: "2027-02-01",
  priceAfterStartKopecks: 5_990_000,
};

export const betweenState: SaleFixtureState = {
  ...runningState,
  name: "Третий поток",
  stage: "between",
  startsOn: null,
  nextEvent: "Эфир с разбором программы 15 декабря в 19:00 по Москве",
};

export const activationRules: readonly ActivationRuleFixture[] = [
  {
    id: "97000000-0000-4000-8000-0000000000a1",
    code: "AIENG-SPRING-2025",
    name: "Весенний поток прежнего курса",
    revision: 2,
    productId: saleProductId,
    sourceRef: "inside-course:ai-engineering-spring-2025",
    verificationMode: "course_membership",
    published: true,
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: null,
  },
  {
    id: "97000000-0000-4000-8000-0000000000a2",
    code: "AIENG-BETA",
    name: "Бета-группа прежнего курса с длинным названием для проверки переноса строки",
    revision: 1,
    productId: saleProductId,
    sourceRef: "inside-course:ai-engineering-beta-group-2024-closed-cohort",
    verificationMode: "course_membership",
    published: false,
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: null,
  },
  {
    id: "97000000-0000-4000-8000-0000000000a3",
    code: "OTHER-COURSE",
    name: "Правило другого продукта",
    revision: 1,
    productId: "97000000-0000-4000-8000-000000000099",
    sourceRef: "inside-course:other",
    verificationMode: "course_membership",
    published: true,
    startsAt: "2026-09-01T00:00:00.000Z",
    endsAt: null,
  },
];

export interface SaleBffOptions {
  readonly price?: SaleFixturePrice | null;
  readonly salesState?: SaleFixtureState | null;
  readonly rules?: readonly ActivationRuleFixture[];
  /** Первая запись цены или состояния получает конфликт ревизии, как после правки в другой вкладке. */
  readonly conflictOnce?: boolean;
  /** Чтение продажи отвечает этим отказом. */
  readonly readFailure?: "forbidden" | "unavailable";
  /** Чтения не отвечают: вкладка остаётся в загрузке. */
  readonly pending?: boolean;
}

function priceSnapshot(price: SaleFixturePrice, productId = saleProductId) {
  return {
    product: {
      id: productId,
      name: price.name,
      priceRevision: price.revision,
    },
    offer: {
      id: offerId,
      revision: price.revision,
      name: price.name,
      benefits: [`product:${productId}`],
      archived: false,
      published: price.published,
    },
    paymentOption: {
      id: paymentOptionId,
      revision: price.revision,
      offerId,
      mode: "one_time",
      months: 1,
      priceKopecks: price.priceKopecks,
      archived: false,
    },
    promotion: null,
    currency: "RUB",
    timezone: "Europe/Moscow",
    firstPriceKopecks: price.priceKopecks,
    renewalPriceKopecks: price.priceKopecks,
  };
}

const commandSchema = z.object({
  expectedRevision: z.number().optional(),
  value: z.unknown().optional(),
});
const priceValueSchema = z.object({
  name: z.string(),
  priceKopecks: z.number(),
  published: z.boolean(),
});
const salesStateValueSchema = z.object({
  productId: z.string(),
  name: z.string(),
  stage: z.enum(["announcement", "preorder", "running", "between"]),
  startsOn: z.string().nullable(),
  nextEvent: z.string(),
  priceAfterStartKopecks: z.number().nullable(),
});
const ruleValueSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  productId: z.string(),
  sourceRef: z.string(),
  verificationMode: z.literal("course_membership").default("course_membership"),
  published: z.boolean(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
});

const ok = (value: unknown) => Response.json({ ok: true, value });
const refused = (code: string) => Response.json({ ok: false, code });

/** Ответы BFF на один показ story. */
export function productSaleBff(options: SaleBffOptions = {}): MutationFetch {
  let price = options.price ?? null;
  let salesState = options.salesState ?? null;
  let rules = [...(options.rules ?? [])];
  let conflict = options.conflictOnce === true;
  const catalog = (id: string, revision: number, published?: boolean) =>
    ok({
      operationRef,
      result: {
        outcome: "catalog",
        value: {
          id,
          revision,
          archived: false,
          ...(published === undefined ? {} : { published }),
        },
      },
    });
  return async (input, init) => {
    const path = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    ).pathname;
    const command = commandSchema.parse(
      typeof init?.body === "string" ? JSON.parse(init.body) : {},
    );
    const salesStatesRead =
      path === "/api/authoring/billing/product-sales-states";
    if (options.pending === true && (path.endsWith("/read") || salesStatesRead))
      return new Promise<Response>(() => undefined);
    if (path === "/api/authoring/billing/product-prices/read")
      return options.readFailure === undefined
        ? ok({
            operationRef,
            result: {
              outcome: "catalogOffers",
              items: price === null ? [] : [priceSnapshot(price)],
              nextCursor: null,
            },
          })
        : refused(options.readFailure);
    if (salesStatesRead) return ok(salesState === null ? [] : [salesState]);
    if (path === "/api/authoring/billing/product-prices/save") {
      if (conflict || command.expectedRevision !== price?.revision) {
        conflict = false;
        if (price !== null) price = { ...price, revision: price.revision + 1 };
        return refused("revision_conflict");
      }
      const value = priceValueSchema.parse(command.value);
      price = { ...value, revision: (price?.revision ?? 0) + 1 };
      return catalog(saleProductId, price.revision, price.published);
    }
    if (path === "/api/authoring/billing/product-prices/archive") {
      price = null;
      return catalog(saleProductId, 99, false);
    }
    if (path === "/api/authoring/billing/product-sales-states/save") {
      if (conflict || command.expectedRevision !== salesState?.revision) {
        conflict = false;
        if (salesState !== null)
          salesState = { ...salesState, revision: salesState.revision + 1 };
        return refused("revision_conflict");
      }
      salesState = {
        ...salesStateValueSchema.parse(command.value),
        revision: (salesState?.revision ?? 0) + 1,
      };
      return catalog(saleProductId, salesState.revision);
    }
    if (path === "/api/authoring/billing/activation-rules/list")
      return ok({
        operationRef,
        result: { outcome: "activationRules", items: rules },
      });
    if (path === "/api/authoring/billing/activation-rules/save") {
      const value = ruleValueSchema.parse(command.value);
      const current = rules.find((rule) => rule.id === value.id);
      const saved = { ...value, revision: (current?.revision ?? 0) + 1 };
      rules = [...rules.filter((rule) => rule.id !== value.id), saved];
      return ok({
        operationRef,
        result: { outcome: "activationRule", value: saved },
      });
    }
    return refused("unavailable");
  };
}

export interface CatalogSaleFake {
  /** Цены владельца по продуктам; продукта без записи цена не задана. */
  readonly prices: Readonly<Record<string, SaleFixturePrice>>;
  readonly salesStates: readonly SaleFixtureState[];
  /** Чтение цен владельца отвечает этим отказом. */
  readonly pricesFailure?: "forbidden" | "unavailable";
  /** Чтения не отвечают: колонка продажи остаётся в загрузке. */
  readonly pending?: boolean;
}

/**
 * Ответ BFF продаж каталога для списка продуктов (каталог цен владельца `catalog` и
 * `product-sales-states`); `null`, когда запрос не к ним.
 */
export function catalogSaleResponse(
  input: RequestInfo | URL,
  fake: CatalogSaleFake,
): Promise<Response> | null {
  const path = new URL(
    input instanceof Request ? input.url : String(input),
    window.location.origin,
  ).pathname;
  if (
    path !== "/api/authoring/billing/catalog" &&
    path !== "/api/authoring/billing/product-sales-states"
  )
    return null;
  if (fake.pending === true) return new Promise<Response>(() => undefined);
  if (path === "/api/authoring/billing/product-sales-states")
    return Promise.resolve(ok(fake.salesStates));
  if (fake.pricesFailure !== undefined)
    return Promise.resolve(refused(fake.pricesFailure));
  return Promise.resolve(
    ok(
      Object.entries(fake.prices).map(([productId, price]) =>
        priceSnapshot(price, productId),
      ),
    ),
  );
}
