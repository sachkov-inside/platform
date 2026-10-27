import type { PaymentLink, PriceSnapshot } from "@/entities/subscription";
import type { PromotionListItem } from "@/features/promotions/model/promotion-operations";
import type { RespondentsView } from "@/features/promotions/model/promotion-operations";
import { getQueryClient } from "@/shared/api/query-client";

import type { MutationFetch } from "./mutation-mock";

/**
 * Каталог цен, ссылки на оплату, скидки и анкетные скидки для историй раздела «Продажи» (#1718).
 * Данные детерминированы: без случайности и текущих часов, с русскими названиями реальной длины.
 */

const id = (prefix: string, index: number) =>
  `${prefix}-0000-4000-8000-${String(index).padStart(12, "0")}`;

interface StoryProduct {
  readonly id: string;
  readonly name: string;
  readonly priceKopecks: number;
}

export const storyProducts: readonly StoryProduct[] = [
  { id: id("98000000", 1), name: "AI Engineering", priceKopecks: 2_990_000 },
  {
    id: id("98000000", 2),
    name: "Агентная разработка: от первого агента до команды агентов",
    priceKopecks: 1_990_000,
  },
  {
    id: id("98000000", 3),
    name: "Архитектура систем",
    priceKopecks: 3_900_000,
  },
  ...Array.from({ length: 22 }, (_, index) => ({
    id: id("98000000", index + 11),
    name: `Практикум по инженерии ${String(index + 1).padStart(2, "0")}`,
    priceKopecks: 990_000 + index * 10_000,
  })),
];

function product(index: number): StoryProduct {
  const found = storyProducts[index];
  if (found === undefined)
    throw new Error(`Missing story product ${String(index)}`);
  return found;
}

export function storyPriceSnapshot(
  item: StoryProduct,
  firstPriceKopecks = item.priceKopecks,
  linkId?: string,
): PriceSnapshot {
  const offerId = item.id.replace(/^98/u, "99");
  return {
    product: { id: item.id, name: item.name, priceRevision: 2 },
    offer: {
      id: offerId,
      revision: 1,
      name: item.name,
      benefits: [`product:${item.id}`],
      benefitPeriods: [{ capability: `product:${item.id}`, months: null }],
      archived: false,
      published: true,
    },
    paymentOption: {
      id: offerId.replace(/^99/u, "9a"),
      revision: 1,
      offerId,
      mode: "one_time",
      months: 1,
      priceKopecks: item.priceKopecks,
      archived: false,
    },
    promotion: null,
    currency: "RUB",
    timezone: "Europe/Moscow",
    ...(linkId === undefined
      ? {}
      : {
          individualPayment: { linkId, basePriceKopecks: item.priceKopecks },
        }),
    firstPriceKopecks,
    renewalPriceKopecks: firstPriceKopecks,
  };
}

export const storyCatalog: readonly PriceSnapshot[] = storyProducts.map(
  (item) => storyPriceSnapshot(item),
);

const linkStates = [
  "active",
  "paid",
  "pending",
  "revoked",
  "expired",
  "unknown",
  "changed",
] as const;

/** `count` ссылок от новых к старым: все состояния по очереди, разные продукты и сроки. */
export function storyPaymentLinks(count: number): readonly PaymentLink[] {
  return Array.from({ length: count }, (_, index) => {
    const linkId = id("98100000", index + 1);
    const item = product(index % 3);
    return {
      id: linkId,
      revision: 1,
      state: linkStates[index % linkStates.length] ?? "active",
      createdAt: new Date(
        Date.UTC(2026, 9, 26, 9) - index * 5 * 3_600_000,
      ).toISOString(),
      expiresAt:
        index % 3 === 1
          ? null
          : new Date(Date.UTC(2026, 10, 15 + (index % 10), 21)).toISOString(),
      snapshot: storyPriceSnapshot(
        item,
        Math.round(item.priceKopecks * (index % 2 === 0 ? 0.85 : 1)),
        linkId,
      ),
    };
  });
}

/** Скидки владельца: действующая на два продукта, на все продукты, запланированная, исчерпанная и завершённая. */
export const storyPromotions: readonly PromotionListItem[] = [
  {
    id: id("98200000", 1),
    revision: 3,
    name: "Осенняя скидка на AI Engineering и агентную разработку",
    percent: 20,
    code: "AUTUMN",
    startsAt: "2026-09-30T21:00:00.000Z",
    endsAt: "2098-12-31T21:00:00.000Z",
    productIds: [product(0).id, product(1).id, product(2).id],
    usageLimit: 50,
    archived: false,
    usedCount: 12,
    questionnaire: false,
    legacy: false,
  },
  {
    id: id("98200000", 2),
    revision: 1,
    name: "Скидка выпускникам",
    percent: 10,
    code: null,
    startsAt: "2026-08-31T21:00:00.000Z",
    endsAt: "2098-12-31T21:00:00.000Z",
    productIds: [],
    usageLimit: null,
    archived: false,
    usedCount: 1_240,
    questionnaire: false,
    legacy: false,
  },
  {
    id: id("98200000", 3),
    revision: 1,
    name: "Предзаказ на весенний поток",
    percent: 25,
    code: "SPRING27",
    startsAt: "2098-02-28T21:00:00.000Z",
    endsAt: "2098-03-31T21:00:00.000Z",
    productIds: [product(2).id],
    usageLimit: 100,
    archived: false,
    usedCount: 0,
    questionnaire: false,
    legacy: false,
  },
  {
    id: id("98200000", 4),
    revision: 2,
    name: "Первые двадцать покупателей",
    percent: 30,
    code: "FIRST20",
    startsAt: "2026-09-30T21:00:00.000Z",
    endsAt: "2098-12-31T21:00:00.000Z",
    productIds: [product(0).id],
    usageLimit: 20,
    archived: false,
    usedCount: 20,
    questionnaire: false,
    legacy: false,
  },
  {
    id: id("98200000", 5),
    revision: 4,
    name: "Чёрная пятница",
    percent: 40,
    code: "BLACK",
    startsAt: "2025-11-27T21:00:00.000Z",
    endsAt: "2025-11-30T21:00:00.000Z",
    productIds: [product(0).id],
    usageLimit: null,
    archived: false,
    usedCount: 87,
    questionnaire: false,
    legacy: false,
  },
];

/** Архивные скидки: прежняя область без продуктов и архивная скидка на все продукты. */
export const storyArchivedPromotions: readonly PromotionListItem[] = [
  {
    id: id("98200000", 11),
    revision: 2,
    name: "Скидка подписчикам Tribute",
    percent: 30,
    code: null,
    startsAt: "2024-12-31T21:00:00.000Z",
    endsAt: "2025-02-28T21:00:00.000Z",
    productIds: [],
    usageLimit: null,
    archived: true,
    usedCount: 61,
    questionnaire: false,
    legacy: true,
  },
  {
    id: id("98200000", 12),
    revision: 3,
    name: "Новогодняя скидка на все продукты",
    percent: 15,
    code: "NY2026",
    startsAt: "2025-12-24T21:00:00.000Z",
    endsAt: "2026-01-10T21:00:00.000Z",
    productIds: [],
    usageLimit: null,
    archived: true,
    usedCount: 133,
    questionnaire: false,
    legacy: false,
  },
];

export const storyRespondents: RespondentsView = {
  total: 312,
  issued: 48,
  purchased: 21,
  respondents: Array.from({ length: 64 }, (_, index) => ({
    username:
      ["anna_dev", "kirill_codes", "olga_qa", "maxim_platform_engineering"][
        index % 4
      ]?.concat(index < 4 ? "" : `_${String(index)}`) ?? "respondent",
    issuedAt:
      index % 3 === 2
        ? null
        : new Date(Date.UTC(2026, 4, 12, 9) + index * 3_600_000).toISOString(),
    purchased: index % 3 === 0,
  })),
};

export interface SalesCatalogFixture {
  readonly links?: readonly PaymentLink[];
  readonly promotions?: readonly PromotionListItem[];
  readonly archivedPromotions?: readonly PromotionListItem[];
  readonly respondents?: RespondentsView;
  readonly catalog?: readonly PriceSnapshot[];
  /** Чтения отвечают отказом зависимости: состояние ошибки. */
  readonly unavailable?: boolean;
  /** Чтения отвечают отказом в праве `billing:manage`: состояние отказа. */
  readonly forbidden?: boolean;
  /** Чтения не отвечают: состояние загрузки. */
  readonly held?: boolean;
  /** Ответ на запись скидки: по умолчанию успех. */
  readonly saveCode?: "revision_conflict";
}

const operationRef = "98f00000-0000-4000-8000-000000000001";
const envelope = (result: unknown) =>
  Response.json({ ok: true, value: { operationRef, result } });

function bodyOf(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== "string") return {};
  const parsed: unknown = JSON.parse(init.body);
  return typeof parsed === "object" && parsed !== null
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

const pageSize = (body: Record<string, unknown>) =>
  typeof body["limit"] === "number" ? body["limit"] : 50;

function pageOf<Item extends { readonly id: string }>(
  items: readonly Item[],
  body: Record<string, unknown>,
) {
  const start =
    typeof body["cursor"] === "string"
      ? items.findIndex((item) => item.id === body["cursor"]) + 1
      : 0;
  const slice = items.slice(start, start + pageSize(body));
  const last = slice.at(-1);
  return {
    items: slice,
    nextCursor:
      start + slice.length < items.length && last !== undefined
        ? last.id
        : null,
  };
}

/** Ответы BFF раздела «Продажи» для историй: каталог цен, ссылки, скидки и анкетные скидки. */
export function salesCatalogFetch(fixture: SalesCatalogFixture): MutationFetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
      "https://inside.test",
    );
    if (fixture.held === true) return new Promise<Response>(() => undefined);
    const body = bodyOf(init);
    const read = (respond: () => Response) =>
      Promise.resolve(
        fixture.forbidden === true
          ? Response.json({ ok: false, code: "forbidden" })
          : fixture.unavailable === true
            ? Response.json({ ok: false, code: "unavailable" })
            : respond(),
      );
    switch (url.pathname) {
      case "/api/authoring/billing/catalog":
        return fixture.forbidden === true
          ? Response.json({ ok: false, code: "forbidden" }, { status: 403 })
          : fixture.unavailable === true
            ? Response.json({ ok: false, code: "unavailable" }, { status: 503 })
            : Response.json({
                ok: true,
                value: {
                  items: fixture.catalog ?? storyCatalog,
                  archivedProductIds: [],
                },
              });
      case "/api/authoring/billing/payment-links/list":
        return read(() =>
          envelope({
            outcome: "paymentLinks",
            ...pageOf(
              (fixture.links ?? []).filter(
                (link) =>
                  (body["state"] === undefined ||
                    link.state === body["state"]) &&
                  (body["productId"] === undefined ||
                    link.snapshot.product?.id === body["productId"]),
              ),
              body,
            ),
          }),
        );
      case "/api/authoring/billing/payment-links/create": {
        const productId = String(body["productId"]);
        const item =
          storyProducts.find((candidate) => candidate.id === productId) ??
          product(0);
        const price = body["price"];
        const amount =
          typeof price === "object" &&
          price !== null &&
          "amountKopecks" in price &&
          typeof price.amountKopecks === "number"
            ? price.amountKopecks
            : typeof price === "object" &&
                price !== null &&
                "percent" in price &&
                typeof price.percent === "number"
              ? Math.round((item.priceKopecks * (100 - price.percent)) / 100)
              : item.priceKopecks;
        const linkId = id("98100000", 901);
        return envelope({
          outcome: "paymentLink",
          value: {
            id: linkId,
            revision: 1,
            state: "active",
            createdAt: "2026-10-27T09:00:00.000Z",
            expiresAt:
              typeof body["expiresAt"] === "string" ? body["expiresAt"] : null,
            snapshot: storyPriceSnapshot(item, amount, linkId),
          },
        });
      }
      case "/api/authoring/billing/promotions/list":
        return read(() =>
          envelope({
            outcome: "promotions",
            ...pageOf(
              body["archived"] === true
                ? (fixture.archivedPromotions ?? [])
                : (fixture.promotions ?? []),
              body,
            ),
          }),
        );
      case "/api/authoring/billing/promotions/save":
        return fixture.saveCode === undefined
          ? envelope({
              outcome: "catalog",
              value: { id: id("98200000", 99), revision: 2, archived: false },
            })
          : Response.json({ ok: false, code: fixture.saveCode });
      case "/api/authoring/billing/respondents/status":
        return read(() =>
          envelope({
            outcome: "respondents",
            value: fixture.respondents ?? storyRespondents,
          }),
        );
      default:
        return new Response(null, { status: 404 });
    }
  };
}

/** Каждая история читает свой набор: общий клиент запросов Storybook забывает чужие ответы. */
export function forgetSalesCatalogQueries(): void {
  const client = getQueryClient();
  for (const key of [
    "owner-price-catalog",
    "owner-payment-links",
    "owner-promotions",
    "owner-questionnaire-respondents",
  ])
    client.removeQueries({ queryKey: [key] });
}
