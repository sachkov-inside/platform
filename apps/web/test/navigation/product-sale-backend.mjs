// @ts-check
import { z } from "zod";

/**
 * Подставные цены, состояния продажи и правила активации для вкладок «Продажа» и «Сообщество и
 * активация» страницы продукта (#1718). Это HTTP-двойник `POST /billing/admin` и публичного
 * `GET /billing/product-sales-states`, а не проверка прав: любой токен владельца получает тот же
 * каталог. Ревизии проверяются, как в billing. `POST /__product-sale/reset` возвращает исходный
 * каталог перед каждой проверкой.
 */

const operationRef = "c0110000-0000-4000-8000-0000000001f0";
const offerId = "c0110000-0000-4000-8000-0000000001f1";
const paymentOptionId = "c0110000-0000-4000-8000-0000000001f2";

const commandSchema = z
  .object({
    operation: z.string(),
    operationId: z.string(),
    expectedRevision: z.number().int().positive().optional(),
    productId: z.string().optional(),
    id: z.string().optional(),
    value: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const priceValueSchema = z.object({
  productId: z.string(),
  name: z.string(),
  priceKopecks: z.number().int().positive(),
  published: z.boolean(),
});
const salesStateValueSchema = z.object({
  productId: z.string(),
  name: z.string(),
  stage: z.enum(["announcement", "preorder", "running", "between"]),
  startsOn: z.string().nullable(),
  nextEvent: z.string(),
  priceAfterStartKopecks: z.number().int().positive().nullable(),
});

/**
 * @typedef {{ productId: string; name: string; priceKopecks: number; published: boolean; revision: number; archived: boolean }} Price
 * @typedef {z.infer<typeof salesStateValueSchema> & { revision: number }} SalesState
 */

/** @returns {{ prices: Price[]; states: SalesState[]; rules: unknown[] }} */
function initialCatalog() {
  return {
    prices: [
      {
        productId: "c0110000-0000-4000-8000-000000000001",
        name: "Архитектура приложения",
        priceKopecks: 2_990_000,
        published: false,
        revision: 2,
        archived: false,
      },
    ],
    states: [
      {
        productId: "c0110000-0000-4000-8000-000000000001",
        name: "Первый поток",
        stage: "preorder",
        startsOn: "2027-02-01",
        nextEvent: "",
        priceAfterStartKopecks: null,
        revision: 1,
      },
    ],
    rules: [],
  };
}

let catalog = initialCatalog();

/** @param {Price} price */
function snapshot(price) {
  return {
    product: {
      id: price.productId,
      name: price.name,
      priceRevision: price.revision,
    },
    offer: {
      id: offerId,
      revision: price.revision,
      name: price.name,
      benefits: [`product:${price.productId}`],
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

const conflict = {
  status: 409,
  value: { code: "revision_conflict", status: 409 },
};

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @returns {Promise<{status: number, value: unknown} | null>}
 */
export async function productSaleRoute(request, url, readBody) {
  if (url.pathname === "/__product-sale/reset" && request.method === "POST") {
    catalog = initialCatalog();
    return { status: 200, value: { reset: true } };
  }
  if (
    url.pathname === "/billing/product-sales-states" &&
    request.method === "GET"
  ) {
    const productId = url.searchParams.get("productId");
    return {
      status: 200,
      value: {
        items: catalog.states.filter(
          (state) => productId === null || state.productId === productId,
        ),
        nextCursor: null,
      },
    };
  }
  if (url.pathname !== "/billing/admin" || request.method !== "POST")
    return null;
  if (request.headers.authorization === undefined)
    return { status: 401, value: { code: "invalid_proof", status: 401 } };
  const command = commandSchema.parse(JSON.parse(await readBody(request)));
  switch (command.operation) {
    case "productPrices.list":
      return {
        status: 200,
        value: {
          operationRef,
          result: {
            outcome: "catalogOffers",
            items: catalog.prices
              .filter(
                (price) =>
                  !price.archived &&
                  (command.productId === undefined ||
                    price.productId === command.productId),
              )
              .map(snapshot),
            nextCursor: null,
          },
        },
      };
    case "productPrices.save": {
      const value = priceValueSchema.parse(command.value);
      const current = catalog.prices.find(
        (price) => price.productId === value.productId,
      );
      if (current?.revision !== command.expectedRevision) return conflict;
      const saved = {
        ...value,
        revision: (current?.revision ?? 0) + 1,
        archived: false,
      };
      catalog.prices = [
        ...catalog.prices.filter(
          (price) => price.productId !== value.productId,
        ),
        saved,
      ];
      return {
        status: 200,
        value: {
          operationRef,
          result: {
            outcome: "catalog",
            value: {
              id: saved.productId,
              revision: saved.revision,
              archived: false,
              published: saved.published,
            },
          },
        },
      };
    }
    case "productSalesState.save": {
      const value = salesStateValueSchema.parse(command.value);
      const current = catalog.states.find(
        (state) => state.productId === value.productId,
      );
      if (current?.revision !== command.expectedRevision) return conflict;
      const saved = { ...value, revision: (current?.revision ?? 0) + 1 };
      catalog.states = [
        ...catalog.states.filter(
          (state) => state.productId !== value.productId,
        ),
        saved,
      ];
      return {
        status: 200,
        value: {
          operationRef,
          result: {
            outcome: "catalog",
            value: {
              id: saved.productId,
              revision: saved.revision,
              archived: false,
            },
          },
        },
      };
    }
    case "activationRules.list":
      return {
        status: 200,
        value: {
          operationRef,
          result: { outcome: "activationRules", items: catalog.rules },
        },
      };
    default:
      return {
        status: 400,
        value: { code: "invalid_request", status: 400 },
      };
  }
}
