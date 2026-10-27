import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn<() => Promise<string>>(),
  manage: vi.fn(),
  salesStates: vi.fn(),
}));
vi.mock("@/shared/api/backend/index.server", () => ({
  requestManageBilling: fakes.manage,
  requestProductSalesStates: fakes.salesStates,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: () => fakes.token(),
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: class extends Error {},
}));

import * as readPriceRoute from "../../app/api/authoring/billing/product-prices/read/route";
import * as savePriceRoute from "../../app/api/authoring/billing/product-prices/save/route";
import * as archivePriceRoute from "../../app/api/authoring/billing/product-prices/archive/route";
import * as readStateRoute from "../../app/api/authoring/billing/product-sales-states/read/route";
import * as saveStateRoute from "../../app/api/authoring/billing/product-sales-states/save/route";
import { archiveProductPriceOperation } from "@/features/product-sale-settings/api/archive-product-price.operation";
import { saveProductPriceOperation } from "@/features/product-sale-settings/api/save-product-price.operation";
import { saveProductSalesStateOperation } from "@/features/product-sale-settings/api/save-product-sales-state.operation";
import {
  deriveSaleStatus,
  ownerPriceOf,
  priceCommand,
  saleFailureMessage,
  salesStateCommand,
  salesStateDraftOf,
  salesStateErrors,
  type OwnerProductPrice,
} from "@/features/product-sale-settings/model/product-sale";
import { readProductSale } from "@/features/product-sale-settings/model/use-product-sale.client";
import type { PriceSnapshot, ProductSalesState } from "@/entities/subscription";

import { routeBrowserMutations } from "../support/mutation-operation-route";

const productId = "00000000-0000-4000-8000-000000001718";
const otherProductId = "00000000-0000-4000-8000-000000001719";
const operationId = "20000000-0000-4000-8000-000000000001";

const price: OwnerProductPrice = {
  revision: 3,
  name: "AI Engineering, разовая покупка",
  priceKopecks: 4_990_000,
  published: true,
};
const salesState: ProductSalesState = {
  productId,
  revision: 2,
  name: "Поток 2",
  stage: "preorder",
  startsOn: "2026-11-20",
  nextEvent: "",
  priceAfterStartKopecks: 5_990_000,
};

function snapshot(id: string, published?: boolean): PriceSnapshot {
  const offerId = "00000000-0000-4000-8000-000000000101";
  return {
    product: { id, name: price.name, priceRevision: price.revision },
    offer: {
      id: offerId,
      revision: 1,
      name: price.name,
      benefits: [`product:${id}`],
      archived: false,
      ...(published === undefined ? {} : { published }),
    },
    paymentOption: {
      id: "00000000-0000-4000-8000-000000000102",
      revision: 1,
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

const ok = (body: unknown) => ({ ok: true, body, response: new Response() });
const problem = (code: string, status: number) => ({
  ok: false,
  problem: { code },
  response: new Response(null, { status }),
});
const catalog = (items: readonly PriceSnapshot[]) =>
  ok({
    operationRef: operationId,
    result: { outcome: "catalogOffers", items, nextCursor: null },
  });

const routes = {
  "/api/authoring/billing/product-prices/read": readPriceRoute,
  "/api/authoring/billing/product-prices/save": savePriceRoute,
  "/api/authoring/billing/product-prices/archive": archivePriceRoute,
  "/api/authoring/billing/product-sales-states/read": readStateRoute,
  "/api/authoring/billing/product-sales-states/save": saveStateRoute,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  fakes.token.mockResolvedValue("owner-token");
});

describe("состояние продажи продукта", () => {
  it.each([
    [{ productArchived: true, price, salesState }, "archived"],
    [{ productArchived: false, price: null, salesState }, "unpriced"],
    [
      {
        productArchived: false,
        price: { ...price, published: false },
        salesState,
      },
      "closed",
    ],
    [{ productArchived: false, price, salesState }, "preorder"],
    [
      {
        productArchived: false,
        price,
        salesState: { ...salesState, stage: "announcement" as const },
      },
      "announcement",
    ],
    [
      {
        productArchived: false,
        price,
        salesState: { ...salesState, stage: "between" as const },
      },
      "between",
    ],
    [{ productArchived: false, price, salesState: null }, "running"],
  ] as const)("выводит %o как «%s»", (input, status) => {
    expect(deriveSaleStatus(input)).toBe(status);
  });

  it("читает цену владельца своего продукта и отвергает чужой продукт", () => {
    expect(ownerPriceOf([], productId)).toEqual({ ok: true, price: null });
    expect(ownerPriceOf([snapshot(productId, true)], productId)).toEqual({
      ok: true,
      price,
    });
    expect(ownerPriceOf([snapshot(productId)], productId)).toEqual({
      ok: true,
      price: { ...price, published: false },
    });
    expect(ownerPriceOf([snapshot(otherProductId)], productId)).toEqual({
      ok: false,
    });
  });
});

describe("команды цены", () => {
  it("первая цена называется именем продукта и не открывает продажи", () => {
    expect(
      priceCommand({
        productId,
        productName: "AI Engineering",
        price: null,
        priceKopecks: 990_000,
      }),
    ).toEqual({
      value: {
        productId,
        name: "AI Engineering",
        priceKopecks: 990_000,
        published: false,
      },
    });
  });

  it("новая сумма сохраняет название, продажи и ревизию цены", () => {
    expect(
      priceCommand({
        productId,
        productName: "Другое название",
        price,
        priceKopecks: 3_990_000,
      }),
    ).toEqual({
      expectedRevision: 3,
      value: {
        productId,
        name: price.name,
        priceKopecks: 3_990_000,
        published: true,
      },
    });
  });

  it("закрытие продаж отправляет прежнюю цену с выключенной продажей", () => {
    expect(
      priceCommand({
        productId,
        productName: "AI Engineering",
        price,
        priceKopecks: price.priceKopecks,
        published: false,
      }).value,
    ).toEqual({
      productId,
      name: price.name,
      priceKopecks: price.priceKopecks,
      published: false,
    });
  });
});

describe("форма состояния продажи", () => {
  it("требует дату старта на всех этапах, кроме «Между потоками»", () => {
    const draft = { ...salesStateDraftOf(null), name: "Поток 1" };
    expect(salesStateErrors(draft)).toEqual({
      startsOn: "Этапу нужна дата старта",
    });
    expect(
      salesStateErrors({
        ...draft,
        stage: "between",
        nextEvent: "эфир 15 декабря",
      }),
    ).toEqual({});
  });

  it("требует событие следующего потока между потоками", () => {
    expect(
      salesStateErrors({
        ...salesStateDraftOf(null),
        name: "Поток 1",
        stage: "between",
      }),
    ).toEqual({
      nextEvent: "Между потоками нужно событие следующего потока",
    });
  });

  it("не принимает нечитаемую цену после старта за пустое поле", () => {
    expect(
      salesStateErrors({
        ...salesStateDraftOf(salesState),
        priceAfterStartKopecks: null,
        priceAfterStartInvalid: true,
      }).priceAfterStart,
    ).toMatch(/^Цена после старта/u);
  });

  it("сохраняет пустую дату как её отсутствие и ревизию текущего состояния", () => {
    expect(
      salesStateCommand(productId, salesState, {
        ...salesStateDraftOf(salesState),
        stage: "between",
        startsOn: "",
        nextEvent: "  эфир 15 декабря ",
      }),
    ).toEqual({
      expectedRevision: 2,
      value: {
        productId,
        name: "Поток 2",
        stage: "between",
        startsOn: null,
        nextEvent: "эфир 15 декабря",
        priceAfterStartKopecks: 5_990_000,
      },
    });
    expect(
      salesStateCommand(productId, null, salesStateDraftOf(null)),
    ).not.toHaveProperty("expectedRevision");
  });
});

describe("маршруты продажи", () => {
  it("читает цену одного продукта без перебора каталога", async () => {
    routeBrowserMutations(routes);
    fakes.manage.mockResolvedValue(catalog([snapshot(productId, true)]));
    fakes.salesStates.mockResolvedValue(
      ok({
        items: [{ ...salesState, productId: otherProductId }, salesState],
        nextCursor: null,
      }),
    );

    await expect(readProductSale(productId)).resolves.toEqual({
      price,
      salesState,
    });
    expect(fakes.manage).toHaveBeenCalledTimes(1);
    expect(fakes.manage).toHaveBeenCalledWith(
      {
        operation: "productPrices.list",
        operationId: expect.any(String),
        productId,
        limit: 1,
      },
      "owner-token",
    );
    expect(fakes.salesStates).toHaveBeenCalledWith(productId);
  });

  it("продукт без цены и без состояния продажи читается как пустой, а не как сбой", async () => {
    routeBrowserMutations(routes);
    fakes.manage.mockResolvedValue(catalog([]));
    fakes.salesStates.mockResolvedValue(ok({ items: [], nextCursor: null }));

    await expect(readProductSale(productId)).resolves.toEqual({
      price: null,
      salesState: null,
    });
  });

  it("цена чужого продукта в ответе означает недоступность", async () => {
    routeBrowserMutations(routes);
    fakes.manage.mockResolvedValue(catalog([snapshot(otherProductId, true)]));
    fakes.salesStates.mockResolvedValue(ok({ items: [], nextCursor: null }));

    await expect(readProductSale(productId)).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("отказ в праве остаётся отказом, а не пустой продажей", async () => {
    routeBrowserMutations(routes);
    fakes.manage.mockResolvedValue(problem("forbidden", 403));
    fakes.salesStates.mockResolvedValue(ok({ items: [], nextCursor: null }));

    await expect(readProductSale(productId)).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("конфликт ревизии возвращается один раз и не отправляется повторно", async () => {
    const { requests } = routeBrowserMutations(routes);
    fakes.manage.mockResolvedValue(problem("revision_conflict", 409));
    const command = priceCommand({
      productId,
      productName: "AI Engineering",
      price,
      priceKopecks: 3_990_000,
    });

    await expect(
      saveProductPriceOperation.send({ ...command, operationId }),
    ).resolves.toEqual({ ok: false, code: "revision_conflict" });
    expect(requests).toHaveLength(1);
    expect(fakes.manage).toHaveBeenCalledTimes(1);
    expect(fakes.manage).toHaveBeenCalledWith(
      {
        operation: "productPrices.save",
        operationId,
        expectedRevision: 3,
        value: command.value,
      },
      "owner-token",
    );
    expect(saleFailureMessage("revision_conflict")).toContain(
      "Обновите данные",
    );
  });

  it("архив цены и состояние продажи идут прежними командами billing", async () => {
    routeBrowserMutations(routes);
    fakes.manage.mockResolvedValue(
      ok({
        operationRef: operationId,
        result: {
          outcome: "catalog",
          value: { id: productId, revision: 4, archived: true },
        },
      }),
    );

    await expect(
      archiveProductPriceOperation.send({
        operationId,
        id: productId,
        expectedRevision: 3,
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(fakes.manage).toHaveBeenLastCalledWith(
      {
        operation: "productPrices.archive",
        operationId,
        id: productId,
        expectedRevision: 3,
      },
      "owner-token",
    );

    const state = salesStateCommand(
      productId,
      salesState,
      salesStateDraftOf(salesState),
    );
    await expect(
      saveProductSalesStateOperation.send({ ...state, operationId }),
    ).resolves.toMatchObject({ ok: true });
    expect(fakes.manage).toHaveBeenLastCalledWith(
      { operation: "productSalesState.save", operationId, ...state },
      "owner-token",
    );
  });
});
