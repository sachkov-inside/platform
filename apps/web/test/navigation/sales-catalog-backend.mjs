// @ts-check
import { z } from "zod";

/**
 * «Ссылки на оплату», «Скидки» и «Воронка продаж» навигационного набора (#1718): изолированная
 * HTTP-фикстура в форме контракта Nest, а не проверка прав. Отвечает только на токены
 * `sales-catalog-*`, поэтому другие модули фикстуры видят запросы billing без изменений. Права,
 * фильтры и порядок проверяют интеграционные тесты backend.
 */

const token = "Bearer sales-catalog-owner";
const forbiddenToken = "Bearer sales-catalog-forbidden";

/** @param {number} index */
const productId = (index) =>
  `98000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

/** @typedef {{ id: string, name: string, priceKopecks: number, priceRevision: number }} FixtureProduct */
/** @type {FixtureProduct[]} */
const products = [
  {
    id: productId(1),
    name: "AI Engineering",
    priceKopecks: 2_990_000,
    priceRevision: 3,
  },
  {
    id: productId(2),
    name: "Агентная разработка",
    priceKopecks: 1_990_000,
    priceRevision: 1,
  },
  {
    id: productId(3),
    name: "Архитектура систем",
    priceKopecks: 3_900_000,
    priceRevision: 2,
  },
  ...Array.from({ length: 22 }, (_, index) => ({
    id: productId(index + 11),
    name: `Практикум ${String(index + 1).padStart(2, "0")}`,
    priceKopecks: 990_000 + index * 10_000,
    priceRevision: 1,
  })),
];

/** @param {FixtureProduct} product @param {number} firstPriceKopecks @param {string | undefined} linkId */
function snapshot(
  product,
  firstPriceKopecks = product.priceKopecks,
  linkId = undefined,
) {
  const offerId = product.id.replace(/^98/u, "99");
  return {
    product: {
      id: product.id,
      name: product.name,
      priceRevision: product.priceRevision,
    },
    offer: {
      id: offerId,
      revision: 1,
      name: product.name,
      benefits: [`product:${product.id}`],
      benefitPeriods: [{ capability: `product:${product.id}`, months: null }],
      archived: false,
      published: true,
    },
    paymentOption: {
      id: offerId.replace(/^99/u, "9a"),
      revision: 1,
      offerId,
      mode: "one_time",
      months: 1,
      priceKopecks: product.priceKopecks,
      archived: false,
    },
    promotion: null,
    currency: "RUB",
    timezone: "Europe/Moscow",
    ...(linkId === undefined
      ? {}
      : {
          individualPayment: { linkId, basePriceKopecks: product.priceKopecks },
        }),
    firstPriceKopecks,
    renewalPriceKopecks: firstPriceKopecks,
  };
}

/** @param {number} index */
const productAt = (index) => {
  const product = products[index];
  if (product === undefined)
    throw new Error(`Missing product ${String(index)}`);
  return product;
};

/**
 * @typedef {{ id: string, revision: number, state: string, createdAt: string, expiresAt: string | null, snapshot: ReturnType<typeof snapshot> }} FixtureLink
 */
/** @returns {FixtureLink[]} */
function initialLinks() {
  /** @type {FixtureLink[]} */
  const named = [
    {
      id: "98100000-0000-4000-8000-000000000001",
      revision: 1,
      state: "active",
      createdAt: "2026-10-26T09:00:00.000Z",
      expiresAt: "2026-11-16T00:00:00+03:00",
      snapshot: snapshot(
        productAt(0),
        2_541_500,
        "98100000-0000-4000-8000-000000000001",
      ),
    },
    {
      id: "98100000-0000-4000-8000-000000000002",
      revision: 2,
      state: "paid",
      createdAt: "2026-10-25T09:00:00.000Z",
      expiresAt: null,
      snapshot: snapshot(
        productAt(1),
        1_500_000,
        "98100000-0000-4000-8000-000000000002",
      ),
    },
  ];
  const generated = Array.from({ length: 32 }, (_, index) => {
    const id = `98100000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`;
    return {
      id,
      revision: 1,
      state: index % 4 === 0 ? "revoked" : "active",
      createdAt: new Date(
        Date.parse("2026-10-20T09:00:00.000Z") - index * 3_600_000,
      ).toISOString(),
      expiresAt: null,
      snapshot: snapshot(productAt(2), 3_500_000, id),
    };
  });
  return [...named, ...generated];
}

/**
 * @typedef {{ id: string, revision: number, name: string, percent: number, code: string | null, startsAt: string, endsAt: string, productIds: string[], usageLimit: number | null, archived: boolean, usedCount: number, questionnaire: boolean, legacy: boolean }} FixturePromotion
 */
/** @returns {FixturePromotion[]} */
function initialPromotions() {
  return [
    {
      id: "98200000-0000-4000-8000-000000000001",
      revision: 3,
      name: "Осенняя скидка на AI Engineering",
      percent: 20,
      code: "AUTUMN",
      startsAt: "2026-10-01T00:00:00+03:00",
      endsAt: "2099-01-01T00:00:00+03:00",
      productIds: [productAt(0).id, productAt(1).id],
      usageLimit: 50,
      archived: false,
      usedCount: 12,
      questionnaire: false,
      legacy: false,
    },
    {
      id: "98200000-0000-4000-8000-000000000002",
      revision: 1,
      name: "Скидка выпускникам",
      percent: 10,
      code: null,
      startsAt: "2026-09-01T00:00:00+03:00",
      endsAt: "2099-01-01T00:00:00+03:00",
      productIds: [],
      usageLimit: null,
      archived: false,
      usedCount: 140,
      questionnaire: false,
      legacy: false,
    },
    {
      id: "98200000-0000-4000-8000-000000000003",
      revision: 2,
      name: "Скидка подписчикам Tribute",
      percent: 30,
      code: null,
      startsAt: "2025-01-01T00:00:00+03:00",
      endsAt: "2025-03-01T00:00:00+03:00",
      productIds: [],
      usageLimit: null,
      archived: true,
      usedCount: 61,
      questionnaire: false,
      legacy: true,
    },
  ];
}

let links = initialLinks();
let promotions = initialPromotions();
let created = 0;
/** Owner operations the fixture received, in arrival order, for `GET /__sales-catalog/requests`. */
/** @type {unknown[]} */
let received = [];

const funnelProducts = [
  {
    id: productAt(0).id,
    name: "AI Engineering",
    chapters: [
      {
        id: "98300000-0000-4000-8000-000000000001",
        name: "Глава 1. Проекты и локальный MCP",
      },
      { id: "98300000-0000-4000-8000-000000000002", name: "Глава 2. Агенты" },
    ],
  },
  {
    id: productAt(1).id,
    name: "Агентная разработка",
    chapters: [
      { id: "98300000-0000-4000-8000-000000000003", name: "Введение" },
    ],
  },
];

/** @param {URL} url */
function funnelReport(url) {
  const requestedProduct = url.searchParams.get("productId");
  const product =
    funnelProducts.find((item) => item.id === requestedProduct) ??
    funnelProducts[0];
  if (product === undefined) throw new Error("Missing funnel product");
  const requestedChapter = url.searchParams.get("chapterId");
  const chapter =
    requestedChapter === null
      ? product.chapters[0]
      : product.chapters.find((item) => item.id === requestedChapter);
  if (chapter === undefined) return problem(404, "chapter_not_found");
  const scale = product === funnelProducts[0] ? 1 : 2;
  return {
    status: 200,
    value: {
      generatedAt: "2026-10-27T09:00:00.000Z",
      period: {
        from: url.searchParams.get("from") ?? "2026-09-27T21:00:00.000Z",
        to: url.searchParams.get("to") ?? "2026-10-27T21:00:00.000Z",
      },
      products: funnelProducts,
      selection: { productId: product.id, chapterId: chapter.id },
      lastBotEventReceivedAt: "2026-10-27T08:55:00.000Z",
      rows: [
        {
          source: { kind: "label", code: "m_channel" },
          counts: {
            entered: 412 * scale,
            consented: 301,
            openedChapter: 188,
            checkout: 42,
            paid: 17,
          },
        },
        {
          source: { kind: "outside_bot" },
          counts: {
            entered: null,
            consented: null,
            openedChapter: 64,
            checkout: 11,
            paid: 5,
          },
        },
      ],
      total: {
        entered: 412 * scale,
        consented: 301,
        openedChapter: 252,
        checkout: 53,
        paid: 22,
      },
      waitlist: null,
      surveyRespondents: { uploaded: 312, issued: 48, paid: 21 },
    },
  };
}

/** @param {number} status @param {string} code */
function problem(status, code) {
  return {
    status,
    value: { code, status, title: code, type: `urn:inside:problem:${code}` },
  };
}

/** @param {unknown} result */
function success(result) {
  return {
    status: 200,
    value: { operationRef: "98f00000-0000-4000-8000-000000000001", result },
  };
}

/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} idOf
 * @param {unknown} cursor
 * @param {number} limit
 */
function page(items, idOf, cursor, limit) {
  const start =
    typeof cursor === "string"
      ? items.findIndex((item) => idOf(item) === cursor) + 1
      : 0;
  const slice = items.slice(start, start + limit);
  const last = slice.at(-1);
  return {
    items: slice,
    nextCursor:
      start + limit < items.length && last !== undefined ? idOf(last) : null,
  };
}

const commandSchema = z.object({ operation: z.string() }).passthrough();
const createSchema = z
  .object({
    productId: z.string(),
    priceRevision: z.number(),
    price: z.union([
      z
        .object({ kind: z.literal("amount"), amountKopecks: z.number() })
        .strict(),
      z.object({ kind: z.literal("discount"), percent: z.number() }).strict(),
    ]),
    expiresAt: z.string().nullable(),
  })
  .passthrough();
const revisionSchema = z
  .object({ id: z.string(), expectedRevision: z.number() })
  .passthrough();
const saveSchema = z
  .object({
    expectedRevision: z.number().optional(),
    value: z
      .object({
        id: z.string(),
        name: z.string(),
        percent: z.number(),
        code: z.string().nullable(),
        startsAt: z.string(),
        endsAt: z.string(),
        productIds: z.array(z.string()),
        usageLimit: z.number().nullable(),
      })
      .strict(),
  })
  .passthrough();

/** @param {Record<string, unknown>} body */
function ownerOperation(body) {
  switch (body["operation"]) {
    case "productPrices.list":
      return success({
        outcome: "catalogOffers",
        ...page(
          products.map((product) => snapshot(product)),
          (item) => item.product.id,
          body["cursor"],
          Number(body["limit"] ?? 50),
        ),
      });
    case "paymentLinks.list": {
      const filtered = links
        .filter(
          (link) =>
            (body["productId"] === undefined ||
              link.snapshot.product.id === body["productId"]) &&
            (body["state"] === undefined || link.state === body["state"]),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      return success({
        outcome: "paymentLinks",
        ...page(
          filtered,
          (item) => item.id,
          body["cursor"],
          Number(body["limit"] ?? 50),
        ),
      });
    }
    case "paymentLinks.create": {
      const input = createSchema.parse(body);
      const product = products.find((item) => item.id === input.productId);
      if (product === undefined) return problem(404, "not_found");
      if (product.priceRevision !== input.priceRevision)
        return problem(409, "revision_conflict");
      created += 1;
      const id = `98100000-0000-4000-8000-${String(900 + created).padStart(12, "0")}`;
      const price =
        input.price.kind === "amount"
          ? input.price.amountKopecks
          : Math.round(
              (product.priceKopecks * (100 - input.price.percent)) / 100,
            );
      const link = {
        id,
        revision: 1,
        state: "active",
        createdAt: new Date(
          Date.parse("2026-10-27T09:00:00.000Z") + created * 60_000,
        ).toISOString(),
        expiresAt: input.expiresAt,
        snapshot: snapshot(product, price, id),
      };
      links = [link, ...links];
      return success({ outcome: "paymentLink", value: link });
    }
    case "paymentLinks.revoke": {
      const input = revisionSchema.parse(body);
      const link = links.find((item) => item.id === input.id);
      if (link === undefined) return problem(404, "not_found");
      if (link.revision !== input.expectedRevision)
        return problem(409, "revision_conflict");
      if (link.state !== "active") return problem(409, "state_conflict");
      link.state = "revoked";
      link.revision += 1;
      return success({ outcome: "paymentLink", value: link });
    }
    case "promotions.list": {
      const filtered = promotions.filter(
        (promotion) =>
          promotion.archived === (body["archived"] === true) &&
          promotion.questionnaire === (body["questionnaire"] === true) &&
          (body["productId"] === undefined ||
            promotion.productIds.length === 0 ||
            promotion.productIds.includes(String(body["productId"]))),
      );
      return success({
        outcome: "promotions",
        ...page(
          filtered,
          (item) => item.id,
          body["cursor"],
          Number(body["limit"] ?? 50),
        ),
      });
    }
    case "promotions.save": {
      const input = saveSchema.parse(body);
      const current = promotions.find((item) => item.id === input.value.id);
      if (current === undefined) {
        if (input.expectedRevision !== undefined)
          return problem(404, "not_found");
        promotions = [
          {
            ...input.value,
            revision: 1,
            archived: false,
            usedCount: 0,
            questionnaire: false,
            legacy: false,
          },
          ...promotions,
        ];
        return success({
          outcome: "catalog",
          value: { id: input.value.id, revision: 1, archived: false },
        });
      }
      if (current.revision !== input.expectedRevision)
        return problem(409, "revision_conflict");
      Object.assign(current, input.value, { revision: current.revision + 1 });
      return success({
        outcome: "catalog",
        value: { id: current.id, revision: current.revision, archived: false },
      });
    }
    case "promotions.archive": {
      const input = revisionSchema.parse(body);
      const current = promotions.find((item) => item.id === input.id);
      if (current === undefined) return problem(404, "not_found");
      if (current.revision !== input.expectedRevision)
        return problem(409, "revision_conflict");
      current.archived = true;
      current.revision += 1;
      return success({
        outcome: "catalog",
        value: { id: current.id, revision: current.revision, archived: true },
      });
    }
    case "respondents.status":
      return success({
        outcome: "respondents",
        value: {
          total: 3,
          issued: 2,
          purchased: 1,
          respondents: [
            {
              username: "anna_dev",
              issuedAt: "2026-05-12T09:00:00.000Z",
              purchased: true,
            },
            {
              username: "kirill_codes",
              issuedAt: "2026-05-13T09:00:00.000Z",
              purchased: false,
            },
            { username: "olga_qa", issuedAt: null, purchased: false },
          ],
        },
      });
    default:
      return problem(400, "invalid_request");
  }
}

/**
 * @param {import("node:http").IncomingMessage} request
 * @param {URL} url
 * @param {(request: import("node:http").IncomingMessage) => Promise<string>} readBody
 * @returns {Promise<{status: number, value: unknown} | null>}
 */
export async function salesCatalogRoute(request, url, readBody) {
  if (url.pathname === "/__sales-catalog/reset" && request.method === "POST") {
    links = initialLinks();
    promotions = initialPromotions();
    created = 0;
    received = [];
    return { status: 200, value: { reset: true } };
  }
  if (url.pathname === "/__sales-catalog/requests" && request.method === "GET")
    return { status: 200, value: { requests: received } };
  const authorization = request.headers.authorization;
  if (authorization !== token && authorization !== forbiddenToken) return null;
  if (url.pathname === "/sales-funnel/report" && request.method === "GET") {
    received.push({
      operation: "salesFunnel.report",
      query: Object.fromEntries(url.searchParams),
    });
    return authorization === token
      ? funnelReport(url)
      : problem(403, "forbidden");
  }
  if (url.pathname !== "/billing/admin" || request.method !== "POST")
    return null;
  const body = commandSchema.parse(JSON.parse(await readBody(request)));
  received.push(body);
  if (authorization === forbiddenToken) return problem(403, "forbidden");
  return ownerOperation(body);
}
