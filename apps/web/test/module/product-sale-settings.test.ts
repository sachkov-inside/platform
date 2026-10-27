import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  token: vi.fn<() => Promise<string>>(),
  manage: vi.fn(),
  salesStates: vi.fn(),
  LogtoSessionUnavailableError: class extends Error {},
}));
const { LogtoSessionUnavailableError } = fakes;
vi.mock("@/shared/api/backend/index.server", () => ({
  requestManageBilling: fakes.manage,
  requestProductSalesStates: fakes.salesStates,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: () => fakes.token(),
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: fakes.LogtoSessionUnavailableError,
}));

import * as readPriceRoute from "../../app/api/authoring/billing/product-prices/read/route";
import * as savePriceRoute from "../../app/api/authoring/billing/product-prices/save/route";
import * as archivePriceRoute from "../../app/api/authoring/billing/product-prices/archive/route";
import * as listPricesRoute from "../../app/api/authoring/billing/product-prices/list/route";
import * as salesStatesRoute from "../../app/api/authoring/billing/product-sales-states/route";
import * as saveStateRoute from "../../app/api/authoring/billing/product-sales-states/save/route";
import { archiveProductPriceOperation } from "@/features/product-sale-settings/api/archive-product-price.operation";
import { saveProductPriceOperation } from "@/features/product-sale-settings/api/save-product-price.operation";
import { saveProductSalesStateOperation } from "@/features/product-sale-settings/api/save-product-sales-state.operation";
import {
  catalogSaleStatus,
  deriveSaleStatus,
  ownerPriceOf,
  ownerPricesByProduct,
  priceCommand,
  saleFailureMessage,
  salesStateCommand,
  salesStateDraftOf,
  salesStateErrors,
  saveProductSalesStateInputSchema,
  type OwnerProductPrice,
} from "@/features/product-sale-settings/model/product-sale";
import { readProductSale } from "@/features/product-sale-settings/model/use-product-sale.client";
import {
  readCatalogPrices,
  readCatalogSalesStates,
} from "@/features/product-sale-settings/model/use-catalog-sale.client";
import {
  productSalesStatesSchema,
  type PriceSnapshot,
  type ProductSalesState,
} from "@/entities/subscription";

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
  "/api/authoring/billing/product-sales-states": salesStatesRoute,
  "/api/authoring/billing/product-sales-states/save": saveStateRoute,
  "/api/authoring/billing/product-prices/list": listPricesRoute,
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

  it("читает поток прежнего backend без цены после старта как поток без неё", () => {
    const { priceAfterStartKopecks: _price, ...legacy } = salesState;
    const read = (state: object) =>
      productSalesStatesSchema.safeParse({ items: [state], nextCursor: null });
    expect(read(legacy).data?.items[0]?.priceAfterStartKopecks).toBeNull();
    expect(read(salesState).data?.items[0]?.priceAfterStartKopecks).toBe(
      5_990_000,
    );
    expect(read({ ...salesState, priceAfterStartKopecks: -1 }).success).toBe(
      false,
    );
  });

  it("отправляет поток только с явной ценой после старта или null", () => {
    const { revision: _revision, ...value } = salesState;
    const command = (priceAfterStartKopecks?: unknown) => ({
      operationId,
      expectedRevision: 2,
      value:
        priceAfterStartKopecks === undefined
          ? { ...value, priceAfterStartKopecks: undefined }
          : { ...value, priceAfterStartKopecks },
    });
    const accepts = (priceAfterStartKopecks?: unknown) =>
      saveProductSalesStateInputSchema.safeParse(
        command(priceAfterStartKopecks),
      ).success;
    expect(accepts(null)).toBe(true);
    expect(accepts(3_990_000)).toBe(true);
    for (const invalid of [undefined, 0, -100, 399.5])
      expect(accepts(invalid)).toBe(false);
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
    // Одна запись одного продукта: каталог не перебирается страницами.
    expect(fakes.manage).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "productPrices.list",
        productId,
        limit: 1,
      }),
      "owner-token",
    );
    expect(fakes.salesStates).toHaveBeenCalledWith(productId);
  });

  it("состояния продажи читаются GET без кеша, а без сессии и с неверным продуктом не читаются", async () => {
    fakes.salesStates.mockResolvedValue(
      ok({ items: [salesState], nextCursor: null }),
    );
    const read = await salesStatesRoute.GET(
      new Request(
        `https://inside.example.test/api/authoring/billing/product-sales-states?productId=${productId}`,
      ),
    );
    expect(read.status).toBe(200);
    expect(read.headers.get("cache-control")).toBe("no-store, private");
    expect(await read.json()).toEqual({ ok: true, value: [salesState] });
    expect(fakes.salesStates).toHaveBeenCalledWith(productId);

    fakes.salesStates.mockClear();
    const invalid = await salesStatesRoute.GET(
      new Request(
        "https://inside.example.test/api/authoring/billing/product-sales-states?productId=1718",
      ),
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      ok: false,
      code: "invalid_request",
    });
    expect(fakes.salesStates).not.toHaveBeenCalled();

    fakes.token.mockRejectedValue(new LogtoSessionUnavailableError());
    const signedOut = await salesStatesRoute.GET(
      new Request(
        "https://inside.example.test/api/authoring/billing/product-sales-states",
      ),
    );
    expect(signedOut.status).toBe(401);
    expect(fakes.salesStates).not.toHaveBeenCalled();
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
      {},
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
      {},
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
      {},
    );
  });
});

describe("продажи каталога в списке продуктов", () => {
  const anyOperationId: unknown = expect.any(String);
  const thirdProductId = "00000000-0000-4000-8000-000000001720";
  const prices = new Map([
    [productId, price],
    [otherProductId, { ...price, published: false }],
  ]);
  const states = new Map([[productId, salesState]]);

  it("выводит этап по правилу страницы продукта", () => {
    const reads = { prices, salesStates: states };
    expect(catalogSaleStatus(productId, false, reads)).toBe("preorder");
    expect(catalogSaleStatus(otherProductId, false, reads)).toBe("closed");
    expect(catalogSaleStatus(thirdProductId, false, reads)).toBe("unpriced");
    expect(catalogSaleStatus(productId, true, reads)).toBe("archived");
  });

  it("без цен владельца показывает публичный этап или неизвестность, но не «закрыто»", () => {
    const reads = { prices: null, salesStates: states };
    expect(catalogSaleStatus(productId, false, reads)).toBe("preorder");
    expect(catalogSaleStatus(otherProductId, false, reads)).toBeNull();
    expect(
      catalogSaleStatus(otherProductId, false, {
        prices: null,
        salesStates: null,
      }),
    ).toBeNull();
  });

  it("открытая продажа без прочитанных этапов неизвестна, закрытая остаётся закрытой", () => {
    const reads = { prices, salesStates: null };
    expect(catalogSaleStatus(productId, false, reads)).toBeNull();
    expect(catalogSaleStatus(otherProductId, false, reads)).toBe("closed");
    expect(catalogSaleStatus(thirdProductId, false, reads)).toBe("unpriced");
  });

  it("раскладывает каталог владельца по продуктам", () => {
    expect(
      ownerPricesByProduct([
        snapshot(productId, true),
        snapshot(otherProductId),
      ]),
    ).toEqual(prices);
  });

  it("читает весь каталог цен страницами по 100 без продукта", async () => {
    routeBrowserMutations(routes);
    const cursor = "00000000-0000-4000-8000-0000000017ff";
    fakes.manage
      .mockResolvedValueOnce(
        ok({
          operationRef: operationId,
          result: {
            outcome: "catalogOffers",
            items: [snapshot(productId, true)],
            nextCursor: cursor,
          },
        }),
      )
      .mockResolvedValueOnce(catalog([snapshot(otherProductId)]));

    await expect(readCatalogPrices()).resolves.toEqual(prices);
    expect(fakes.manage).toHaveBeenCalledTimes(2);
    expect(fakes.manage).toHaveBeenNthCalledWith(
      1,
      {
        operation: "productPrices.list",
        operationId: anyOperationId,
        limit: 100,
      },
      "owner-token",
      {},
    );
    expect(fakes.manage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        operation: "productPrices.list",
        cursor,
        limit: 100,
      }),
      "owner-token",
      {},
    );
  });

  it("отказ владельцу в ценах читается как неизвестные цены, а не пустой каталог", async () => {
    routeBrowserMutations(routes);
    fakes.manage.mockResolvedValue(problem("forbidden", 403));

    await expect(readCatalogPrices()).resolves.toBeNull();
  });

  it("читает публичные состояния продажи всех продуктов страницами", async () => {
    routeBrowserMutations(routes);
    const cursor = "00000000-0000-4000-8000-0000000017ff";
    const other = { ...salesState, productId: otherProductId };
    fakes.salesStates
      .mockResolvedValueOnce(ok({ items: [salesState], nextCursor: cursor }))
      .mockResolvedValueOnce(ok({ items: [other], nextCursor: null }));

    await expect(readCatalogSalesStates()).resolves.toEqual(
      new Map([
        [productId, salesState],
        [otherProductId, other],
      ]),
    );
    expect(fakes.salesStates).toHaveBeenNthCalledWith(1, undefined, undefined);
    expect(fakes.salesStates).toHaveBeenNthCalledWith(2, undefined, cursor);
  });

  it("сбой публичного чтения не выдаёт пустые этапы", async () => {
    routeBrowserMutations(routes);
    fakes.salesStates.mockResolvedValue(problem("unavailable", 503));

    await expect(readCatalogSalesStates()).resolves.toBeNull();
  });
});
