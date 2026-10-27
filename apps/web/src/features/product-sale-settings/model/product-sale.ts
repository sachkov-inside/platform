import { z } from "zod";

import {
  cohortStageSchema,
  priceSnapshotSchema,
  productSalesStatesSchema,
  type BillingFailureCode,
  type CohortStage,
  type PriceSnapshot,
  type ProductSalesState,
} from "@/entities/subscription";

const operationId = z.uuid();
const revision = z.int().positive();
const money = z.int().positive();

/** Ключ одного факта: цена владельца и состояние продажи продукта читаются и сбрасываются вместе. */
export function productSaleQueryKey(productId: string) {
  return ["product-sale", productId] as const;
}

// Чтения.

export const readOwnerProductPriceInputSchema = z.strictObject({
  operationId,
  productId: z.uuid(),
});
export const ownerProductPriceOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("catalogOffers"),
    items: z.array(priceSnapshotSchema),
    /** Продукты страницы с ценой в архиве; прежний backend поля не присылает. */
    archivedProductIds: z.array(z.uuid()).default([]),
    nextCursor: z.uuid().nullable(),
  }),
});

export const readProductSalesStateInputSchema = z.strictObject({
  productId: z.uuid(),
});
/** Публичное чтение backend отдаёт страницу; маршрут оставляет только запись этого продукта. */
export const productSalesStateOutcomeSchema = z.object({
  salesState: productSalesStatesSchema.shape.items.element.nullable(),
});

/**
 * Продажи всего каталога для списка продуктов: страница цен владельца (`productPrices.list` без
 * продукта) и страница публичных состояний продажи. Обе идут по продуктам и продолжаются курсором.
 */
export function catalogSaleQueryKey(part?: "prices" | "states") {
  return part === undefined
    ? (["product-sale", "catalog"] as const)
    : (["product-sale", "catalog", part] as const);
}

/** Страница цен каталога за одно чтение: столько принимает `productPrices.list`. */
export const CATALOG_PRICES_PAGE_SIZE = 100;
/** Больше страниц одного чтения список не просит: такой каталог читается как недоступный. */
export const CATALOG_SALE_PAGES_LIMIT = 20;

export const listOwnerProductPricesInputSchema = z.strictObject({
  operationId,
  cursor: z.uuid().optional(),
});
export const listProductSalesStatesInputSchema = z.strictObject({
  cursor: z.uuid().optional(),
});

// Записи: те же команды и проверки ревизии, что и у прежнего раздела продаж.

export const saveProductPriceInputSchema = z.strictObject({
  operationId,
  expectedRevision: revision.optional(),
  value: z.strictObject({
    productId: z.uuid(),
    name: z.string().trim().min(1).max(200),
    priceKopecks: z.int().min(100).max(100_000_000),
    published: z.boolean(),
  }),
});
export type SaveProductPriceInput = z.infer<typeof saveProductPriceInputSchema>;

export const archiveProductPriceInputSchema = z.strictObject({
  operationId,
  id: z.uuid(),
  expectedRevision: revision,
});
export type ArchiveProductPriceInput = z.infer<
  typeof archiveProductPriceInputSchema
>;

export const saveProductSalesStateInputSchema = z.strictObject({
  operationId,
  expectedRevision: revision.optional(),
  value: z.strictObject({
    productId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    stage: cohortStageSchema,
    startsOn: z.iso.date().nullable(),
    nextEvent: z.string().trim().max(200),
    priceAfterStartKopecks: money.nullable(),
  }),
});
export type SaveProductSalesStateInput = z.infer<
  typeof saveProductSalesStateInputSchema
>;

export const catalogOutcomeSchema = z.object({
  operationRef: z.uuid(),
  result: z.object({
    outcome: z.literal("catalog"),
    value: z.object({
      id: z.uuid(),
      revision,
      archived: z.boolean(),
      published: z.boolean().optional(),
    }),
  }),
});

// Представление.

/** Цена продукта у владельца: то, что команда `productPrices.save` принимает обратно. */
export interface OwnerProductPrice {
  readonly revision: number;
  /** Название цены в billing; сохраняется как есть при смене суммы или продаж. */
  readonly name: string;
  readonly priceKopecks: number;
  readonly published: boolean;
}

export interface ProductSaleSnapshot {
  readonly price: OwnerProductPrice | null;
  /**
   * Цена продукта в архиве. Billing не возвращает архивную цену и не принимает новую, поэтому
   * продукт больше не продаётся; `price` тогда `null`.
   */
  readonly priceArchived: boolean;
  readonly salesState: ProductSalesState | null;
}

/**
 * Состояние продажи продукта для плашки. Архив продукта закрывает новые покупки (#1693), поэтому
 * он важнее цены. Цена в архиве окончательна: billing её не возвращает и новую не принимает. Без
 * цены продавать нечего; цена без открытых продаж оплату не принимает. При
 * открытых продажах решает этап состояния продажи: анонс оплату не принимает никогда, остальные
 * этапы принимают. Открытая продажа без состояния продажи страница показывает без этапа и
 * принимает оплату, поэтому она читается как идущая.
 */
export type SaleStatus =
  "unpriced" | "priceArchived" | "closed" | CohortStage | "archived";

export function deriveSaleStatus(input: {
  readonly productArchived: boolean;
  readonly price: OwnerProductPrice | null;
  readonly priceArchived?: boolean;
  readonly salesState: ProductSalesState | null;
}): SaleStatus {
  if (input.productArchived) return "archived";
  if (input.priceArchived === true) return "priceArchived";
  if (input.price === null) return "unpriced";
  if (!input.price.published) return "closed";
  return input.salesState?.stage ?? "running";
}

/**
 * Цена продукта из владельческого каталога. Каталог отдаёт действующие цены и отдельно продукты с
 * ценой в архиве; чужой продукт в ответе означает нарушенный контракт, а не отсутствие цены.
 */
export function ownerPriceOf(
  items: readonly PriceSnapshot[],
  productId: string,
  archivedProductIds: readonly string[] = [],
):
  | {
      readonly ok: true;
      readonly price: OwnerProductPrice | null;
      readonly archived: boolean;
    }
  | {
      readonly ok: false;
    } {
  if (
    items.some((item) => item.product?.id !== productId) ||
    archivedProductIds.some((id) => id !== productId)
  )
    return { ok: false };
  const snapshot = items[0];
  const archived = archivedProductIds.length > 0;
  if (archived && snapshot !== undefined) return { ok: false };
  return {
    ok: true,
    price: snapshot === undefined ? null : ownerPrice(snapshot),
    archived,
  };
}

/** Цены каталога владельца по продуктам; запись без продукта ценой продукта не считается. */
export function ownerPricesByProduct(
  items: readonly PriceSnapshot[],
): ReadonlyMap<string, OwnerProductPrice> {
  const prices = new Map<string, OwnerProductPrice>();
  for (const snapshot of items) {
    const price = ownerPrice(snapshot);
    if (snapshot.product !== undefined && price !== null)
      prices.set(snapshot.product.id, price);
  }
  return prices;
}

function ownerPrice(snapshot: PriceSnapshot): OwnerProductPrice | null {
  if (snapshot.product === undefined) return null;
  return {
    revision: snapshot.product.priceRevision,
    name: snapshot.product.name,
    priceKopecks: snapshot.paymentOption.priceKopecks,
    published: snapshot.offer.published ?? false,
  };
}

/**
 * Прочитанные продажи каталога. `null`: чтение отказано или не удалось, и о нём ничего не известно.
 */
export interface CatalogSaleReads {
  readonly prices: ReadonlyMap<string, OwnerProductPrice> | null;
  /** Продукты с ценой в архиве из того же чтения цен; без поля таких продуктов нет. */
  readonly archivedPrices?: ReadonlySet<string>;
  readonly salesStates: ReadonlyMap<string, ProductSalesState> | null;
}

/**
 * Состояние продажи строки списка продуктов по правилу `deriveSaleStatus`. Без цен владельца
 * (нет права или сбой) известен только публичный этап; без него, как и при открытых продажах с
 * непрочитанным этапом, состояние неизвестно (`null`), а не «продажи закрыты».
 */
export function catalogSaleStatus(
  productId: string,
  productArchived: boolean,
  reads: CatalogSaleReads,
): SaleStatus | null {
  if (productArchived) return "archived";
  const salesState = reads.salesStates?.get(productId) ?? null;
  if (reads.prices === null) return salesState?.stage ?? null;
  const price = reads.prices.get(productId) ?? null;
  const priceArchived = reads.archivedPrices?.has(productId) === true;
  if (reads.salesStates === null && price?.published === true) return null;
  return deriveSaleStatus({
    productArchived,
    price,
    priceArchived,
    salesState,
  });
}

/** Команда цены: название и продажи остаются прежними, у первой цены название продукта. */
export function priceCommand(input: {
  readonly productId: string;
  readonly productName: string;
  readonly price: OwnerProductPrice | null;
  readonly priceKopecks: number;
  readonly published?: boolean;
}): Omit<SaveProductPriceInput, "operationId"> {
  return {
    ...(input.price === null ? {} : { expectedRevision: input.price.revision }),
    value: {
      productId: input.productId,
      name: input.price?.name ?? input.productName.trim().slice(0, 200),
      priceKopecks: input.priceKopecks,
      published: input.published ?? input.price?.published ?? false,
    },
  };
}

/** Границы цены продукта в копейках: те же, что принимает команда. */
export const priceBounds = { min: 100, max: 100_000_000 } as const;

// Состояние продажи.

export const salesStageLabels: Record<CohortStage, string> = {
  announcement: "Анонс: без оплаты, глава 1 бесплатно",
  preorder: "Предзаказ до старта",
  running: "Поток идёт",
  between: "Между потоками",
};

export interface SalesStateDraft {
  readonly stage: CohortStage;
  readonly name: string;
  /** «YYYY-MM-DD» или пустая строка. */
  readonly startsOn: string;
  readonly nextEvent: string;
  readonly priceAfterStartKopecks: number | null;
  /** Текст поля цены после старта не пуст, но не читается как сумма. */
  readonly priceAfterStartInvalid: boolean;
}

export function salesStateDraftOf(
  state: ProductSalesState | null,
): SalesStateDraft {
  return {
    stage: state?.stage ?? "announcement",
    name: state?.name ?? "",
    startsOn: state?.startsOn ?? "",
    nextEvent: state?.nextEvent ?? "",
    priceAfterStartKopecks: state?.priceAfterStartKopecks ?? null,
    priceAfterStartInvalid: false,
  };
}

export type SalesStateErrors = Partial<
  Record<"name" | "startsOn" | "nextEvent" | "priceAfterStart", string>
>;

/**
 * Правила состояния продажи (#1693): дата старта нужна всем этапам, кроме «Между потоками», а
 * этап «Между потоками» без события пообещал бы следующий поток пустой строкой.
 */
export function salesStateErrors(draft: SalesStateDraft): SalesStateErrors {
  const errors: Record<string, string> = {};
  const name = draft.name.trim();
  if (name === "") errors["name"] = "Назовите поток";
  else if (name.length > 120) errors["name"] = "Не длиннее 120 знаков";
  if (draft.stage !== "between" && draft.startsOn === "")
    errors["startsOn"] = "Этапу нужна дата старта";
  const nextEvent = draft.nextEvent.trim();
  if (draft.stage === "between" && nextEvent === "")
    errors["nextEvent"] = "Между потоками нужно событие следующего потока";
  else if (nextEvent.length > 200)
    errors["nextEvent"] = "Не длиннее 200 знаков";
  if (draft.priceAfterStartInvalid)
    errors["priceAfterStart"] =
      "Цена после старта: положительная сумма в рублях, например 39 900 или 39 900,50. Оставьте поле пустым, чтобы не показывать её.";
  return errors;
}

export function salesStateCommand(
  productId: string,
  current: ProductSalesState | null,
  draft: SalesStateDraft,
): Omit<SaveProductSalesStateInput, "operationId"> {
  return {
    ...(current === null ? {} : { expectedRevision: current.revision }),
    value: {
      productId,
      name: draft.name.trim(),
      stage: draft.stage,
      startsOn: draft.startsOn === "" ? null : draft.startsOn,
      nextEvent: draft.nextEvent.trim(),
      priceAfterStartKopecks: draft.priceAfterStartKopecks,
    },
  };
}

const saleFailureMessages: Partial<Record<BillingFailureCode, string>> = {
  revision_conflict:
    "Цена или состояние продажи изменились в другом месте. Обновите данные и проверьте их перед сохранением.",
  operation_conflict:
    "Эта операция уже выполнена с другими данными. Обновите данные.",
  method_unavailable:
    "Приём оплаты сейчас не настроен, поэтому открыть продажи нельзя.",
  invalid_request: "Проверьте сумму и поля состояния продажи.",
  not_found:
    "Цена продукта не найдена: возможно, её отправили в архив. Обновите данные.",
  forbidden: "У вас нет права менять продажи.",
  unauthorized: "Сессия завершилась. Войдите снова.",
};

/** Отказ команды продажи словами владельца. Конфликт ревизии ведёт к перечитыванию, а не к повтору. */
export function saleFailureMessage(code: BillingFailureCode): string {
  return (
    saleFailureMessages[code] ??
    "Продажи сейчас недоступны. Повторите то же действие: запись не выполнится дважды."
  );
}
