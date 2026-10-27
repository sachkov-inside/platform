import type { Route } from "next";
import { z } from "zod";

import type { ContentCover } from "@/entities/material.model";
import type { SaleStatus } from "@/features/product-sale-settings";
import {
  formatCountRu,
  type RussianPluralForms,
} from "@/shared/lib/moscow-format";
import { authoringProductEditorHref } from "@/shared/routing/authoring";
import { internalRoute } from "@/shared/routing/internal-route";
import type { AdminStateKey } from "@/shared/ui/admin";

import type {
  ContentCollection,
  ContentCollectionKind,
} from "./content-collections";

/**
 * Состояние списка тем или продуктов в адресе: `?search=` (название), `?state=` (архив), `?page=`
 * и на странице тем `?topic=` (открытая тема). Backend отдаёт все темы и все продукты одним полным
 * ответом, поэтому поиск, фильтр и страницы по `COLLECTION_PAGE_SIZE` строк считаются в браузере
 * по уже прочитанному списку.
 */
export type CollectionStateFilter = "all" | "active" | "archived";

export interface CollectionListQuery {
  /** Текст поиска как его набрал автор; сравнение идёт без пробелов по краям. */
  readonly search: string;
  readonly state: CollectionStateFilter;
  /** Номер страницы с единицы; больше последней показывает последнюю. */
  readonly page: number;
  /** Тема, открытая на странице тем. У продуктов своя страница, поэтому здесь всегда пусто. */
  readonly topicId?: string;
}

export const COLLECTION_SEARCH_MAX = 160;
export const COLLECTION_PAGE_SIZE = 50;

export const defaultCollectionListQuery: CollectionListQuery = {
  search: "",
  state: "all",
  page: 1,
};

const stateFilterSchema = z.enum(["active", "archived"]);
const topicIdSchema = z.uuid();
const pageSchema = z.coerce.number().int().min(1).max(10_000);

export function parseCollectionListQuery(
  params: URLSearchParams,
  kind: ContentCollectionKind,
): CollectionListQuery {
  const search = (params.get("search") ?? "").slice(0, COLLECTION_SEARCH_MAX);
  const state = stateFilterSchema.safeParse(params.get("state"));
  const topic = topicIdSchema.safeParse(params.get("topic"));
  const page = pageSchema.safeParse(params.get("page"));
  return {
    search: search.trim() === "" ? "" : search,
    state: state.success ? state.data : "all",
    page: page.success ? page.data : 1,
    ...(kind === "topic" && topic.success ? { topicId: topic.data } : {}),
  };
}

/** Канонический текст адреса: значения по умолчанию в адрес не пишутся. */
export function serializeCollectionListQuery(
  query: CollectionListQuery,
): string {
  const params = new URLSearchParams();
  if (query.search.trim() !== "") params.set("search", query.search);
  if (query.state !== "all") params.set("state", query.state);
  if (query.page > 1) params.set("page", String(query.page));
  if (query.topicId !== undefined) params.set("topic", query.topicId);
  return params.toString();
}

export function collectionListHref(
  pathname: string,
  query: CollectionListQuery,
): Route {
  const search = serializeCollectionListQuery(query);
  return internalRoute(search === "" ? pathname : `${pathname}?${search}`);
}

/** Поиск или фильтр сужают список: без них «ничего не найдено» не бывает. */
export function hasCollectionFilters(query: CollectionListQuery): boolean {
  return query.search.trim() !== "" || query.state !== "all";
}

export function withoutCollectionFilters(
  query: CollectionListQuery,
): CollectionListQuery {
  return {
    ...defaultCollectionListQuery,
    ...(query.topicId === undefined ? {} : { topicId: query.topicId }),
  };
}

/** Список без открытой темы: возврат из темы сохраняет поиск и фильтр. */
export function withoutOpenTopic(
  query: CollectionListQuery,
): CollectionListQuery {
  return { search: query.search, state: query.state, page: query.page };
}

export interface CollectionPage<Row> {
  readonly rows: readonly Row[];
  readonly page: number;
  readonly totalPages: number;
  /** «51–100 из 112»; пусто, когда страница одна. */
  readonly summary: string | undefined;
}

/** Страница строк по `COLLECTION_PAGE_SIZE`; номер за последней страницей даёт последнюю. */
export function pageOfCollections<Row>(
  rows: readonly Row[],
  page: number,
): CollectionPage<Row> {
  const totalPages = Math.max(1, Math.ceil(rows.length / COLLECTION_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * COLLECTION_PAGE_SIZE;
  const shown = rows.slice(start, start + COLLECTION_PAGE_SIZE);
  return {
    rows: shown,
    page: current,
    totalPages,
    summary:
      totalPages === 1
        ? undefined
        : `${String(start + 1)}–${String(start + shown.length)} из ${String(rows.length)}`,
  };
}

export function filterCollections(
  collections: readonly ContentCollection[],
  query: CollectionListQuery,
): ContentCollection[] {
  const needle = query.search.trim().toLocaleLowerCase("ru");
  return collections.filter(
    (collection) =>
      (query.state === "all" ||
        collection.archived === (query.state === "archived")) &&
      (needle === "" ||
        collection.name.toLocaleLowerCase("ru").includes(needle)),
  );
}

export const collectionStateFilterOptions: readonly {
  value: CollectionStateFilter;
  label: string;
}[] = [
  { value: "all", label: "Все" },
  { value: "active", label: "Активные" },
  { value: "archived", label: "Архив" },
];

export function collectionStateFilterLabel(
  state: CollectionStateFilter,
): string {
  return (
    collectionStateFilterOptions.find((option) => option.value === state)
      ?.label ?? "Все"
  );
}

const countForms: Record<ContentCollectionKind, RussianPluralForms> = {
  product: ["продукт", "продукта", "продуктов"],
  topic: ["тема", "темы", "тем"],
};

/** «12 продуктов», «3 темы». */
export function formatCollectionCount(
  kind: ContentCollectionKind,
  count: number,
): string {
  return formatCountRu(count, countForms[kind]);
}

/**
 * Строка списка продуктов. Колонки идут в порядке `productListColumnIds`: название, продажа,
 * обладатели, опубликованные материалы, закреп на главной.
 */
export interface ProductListRow {
  readonly id: string;
  readonly name: string;
  /** Адрес продукта на сайте: подстрока названия. */
  readonly caption: string;
  /** Настоящая обложка; без неё строка картинки не показывает. */
  readonly cover: ContentCover | null;
  readonly archived: boolean;
  /** «Архив» у архивного продукта, иначе этап продажи; `null`, когда этап неизвестен. */
  readonly sale: AdminStateKey | null;
  /** Число обладателей; `null`, когда список его не знает. */
  readonly holders: number | null;
  readonly publishedMaterialCount: number;
  readonly href: Route;
}

export const productListColumnIds = [
  "name",
  "sale",
  "holders",
  "published",
  "home",
] as const;
export type ProductListColumnId = (typeof productListColumnIds)[number];

/**
 * Плашка продажи строки. Архив продукта показан словом «Архив», как в фильтре списка; остальные
 * состояния берутся из правила продажи `catalogSaleStatus` (`@/features/product-sale-settings`).
 */
export function productSaleBadge(
  status: SaleStatus | null,
): AdminStateKey | null {
  if (status === null) return null;
  return status === "archived" ? "product.archived" : `sale.${status}`;
}

export function presentProductRow(
  collection: ContentCollection,
  sale: SaleStatus | null,
): ProductListRow {
  return {
    id: collection.id,
    name: collection.name,
    caption: `/products/${collection.slug}`,
    cover: collection.cover ?? null,
    archived: collection.archived,
    sale: productSaleBadge(collection.archived ? "archived" : sale),
    holders: collection.holderCount ?? null,
    publishedMaterialCount: collection.publishedMaterialCount,
    href: authoringProductEditorHref(collection.id),
  };
}

/** Строка списка тем: опубликованные материалы из всех материалов темы. */
export interface TopicListRow {
  readonly id: string;
  readonly name: string;
  readonly caption: string;
  readonly archived: boolean;
  readonly state: "topic.active" | "topic.archived";
  readonly publishedMaterialCount: number;
  readonly materialCount: number;
  /** «4 из 8»: опубликовано из всех материалов темы, черновики тоже считаются. */
  readonly materials: string;
}

export function presentTopicRow(collection: ContentCollection): TopicListRow {
  return {
    id: collection.id,
    name: collection.name,
    caption: `/${collection.slug}`,
    archived: collection.archived,
    state: collection.archived ? "topic.archived" : "topic.active",
    publishedMaterialCount: collection.publishedMaterialCount,
    materialCount: collection.materialCount,
    materials: `${String(collection.publishedMaterialCount)} из ${String(collection.materialCount)}`,
  };
}
