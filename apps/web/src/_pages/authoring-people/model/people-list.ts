import type { Route } from "next";
import { z } from "zod";

import {
  accessOriginLabels,
  accessOriginSchema,
  peopleAccessReadsQueryKey,
  personIdentitySchema,
  productAccessStateSchema,
  type AccessOrigin,
  type ProductAccessState,
} from "@/entities/authoring-person";
import { authoringPeopleHref } from "@/shared/routing/authoring";
import { internalRoute } from "@/shared/routing/internal-route";

/**
 * Список людей (#1721), `GET /authoring/people`. Адрес страницы хранит `q, product, origin, state,
 * cursor`; BFF принимает `query, product, origin, state, cursor` и передаёт их Nest как `query,
 * productId, origin, state, cursor`. Курсор хранит фильтры, поэтому при смене фильтра он уходит.
 */
export interface PeopleListQuery {
  readonly search?: string;
  readonly productId?: string;
  readonly origin?: AccessOrigin;
  readonly state?: ProductAccessState;
  readonly cursor?: string;
}

const instant = z.iso.datetime({ offset: true });
/** Курсор непрозрачен; ограничение длины только не пускает в запрос мусор из адреса. */
const cursorSchema = z.string().min(1).max(512);

export const peopleSearchTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .transform((value) => value.replace(/\s+/gu, " "));

export const personRowSchema = personIdentitySchema
  .extend({
    telegram: z.enum(["linked", "not_linked"]),
    registeredAt: instant,
    lastActivityAt: instant.nullable(),
    products: z.array(
      z
        .object({
          productId: z.uuid(),
          name: z.string(),
          access: productAccessStateSchema,
          origin: accessOriginSchema,
        })
        .strict(),
    ),
  })
  .strict();

export type PersonRow = z.infer<typeof personRowSchema>;

/** Больше совпадений по имени сервер не отдаёт (`nameSearch: "truncated"`). */
export const PEOPLE_NAME_MATCH_LIMIT = 50;

export const peopleListResponseSchema = z
  .object({
    items: z.array(personRowSchema),
    total: z.int().nonnegative(),
    nextCursor: cursorSchema.nullable(),
    /**
     * `unavailable`: запрос был именем, а Telegram не ответил. `truncated`: совпадений по имени
     * больше `PEOPLE_NAME_MATCH_LIMIT`, сервер вернул первые из них, и `total` считает только их.
     */
    nameSearch: z.enum(["available", "unavailable", "truncated"]),
  })
  .strict();

export type PeopleListState =
  | ({ readonly kind: "ready" } & z.infer<typeof peopleListResponseSchema>)
  /**
   * Nest отказал запросу (400): обычно курсор устарел или пришёл из чужого набора фильтров.
   * Повтор того же запроса не поможет, список предлагает начать с первой страницы.
   */
  | { readonly kind: "invalid_query" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "forbidden" }
  | { readonly kind: "unavailable"; readonly reference: string };

export const peopleListStateSchema: z.ZodType<PeopleListState> = z.union([
  peopleListResponseSchema.extend({ kind: z.literal("ready") }),
  z.object({ kind: z.literal("invalid_query") }).strict(),
  z.object({ kind: z.literal("signed_out") }).strict(),
  z.object({ kind: z.literal("forbidden") }).strict(),
  z.object({ kind: z.literal("unavailable"), reference: z.string() }).strict(),
]);

type SearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

function single(value: string | readonly string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

/** Адрес → запрос; значение вне схемы просто не применяется. */
export function parsePeopleListQuery(
  params: SearchParams,
  keys: { readonly search: "q" | "query" } = { search: "q" },
): PeopleListQuery {
  const search = peopleSearchTextSchema.safeParse(single(params[keys.search]));
  const productId = z.uuid().safeParse(single(params["product"]));
  const origin = accessOriginSchema.safeParse(single(params["origin"]));
  const state = productAccessStateSchema.safeParse(single(params["state"]));
  const cursor = cursorSchema.safeParse(single(params["cursor"]));
  return {
    ...(search.success ? { search: search.data } : {}),
    ...(productId.success ? { productId: productId.data } : {}),
    ...(origin.success ? { origin: origin.data } : {}),
    ...(state.success ? { state: state.data } : {}),
    ...(cursor.success ? { cursor: cursor.data } : {}),
  };
}

export function searchParamsRecord(params: URLSearchParams): SearchParams {
  const values: Record<string, string | readonly string[] | undefined> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    values[key] = all.length === 1 ? all[0] : all;
  }
  return values;
}

/** Запрос → параметры; `search` под именем адреса (`q`) или BFF (`query`). */
export function serializePeopleListQuery(
  query: PeopleListQuery,
  searchKey: "q" | "query" = "q",
): string {
  const params = new URLSearchParams();
  if (query.search !== undefined) params.set(searchKey, query.search);
  if (query.productId !== undefined) params.set("product", query.productId);
  if (query.origin !== undefined) params.set("origin", query.origin);
  if (query.state !== undefined) params.set("state", query.state);
  if (query.cursor !== undefined) params.set("cursor", query.cursor);
  return params.toString();
}

export function peopleListHref(query: PeopleListQuery): Route {
  const serialized = serializePeopleListQuery(query);
  return serialized === ""
    ? authoringPeopleHref
    : internalRoute(`${authoringPeopleHref}?${serialized}`);
}

/** Поиск, продукт, способ или состояние сужают список; курсор сам по себе нет. */
export function hasPeopleListFilters(query: PeopleListQuery): boolean {
  return (
    query.search !== undefined ||
    query.productId !== undefined ||
    query.origin !== undefined ||
    query.state !== undefined
  );
}

type FilterKey = "search" | "productId" | "origin" | "state";

/** Запрос после смены одного фильтра: пустое значение снимает его, курсор всегда уходит. */
export function withPeopleListFilter(
  query: PeopleListQuery,
  key: FilterKey,
  value: string | undefined,
): PeopleListQuery {
  const { [key]: _removed, cursor: _cursor, ...rest } = query;
  if (value === undefined || value === "") return rest;
  switch (key) {
    // Поле хранит текст как введён; запрос нормализует его (`parsePeopleListQuery`).
    case "search":
      return { ...rest, search: value };
    case "productId": {
      const parsed = z.uuid().safeParse(value);
      return parsed.success ? { ...rest, productId: parsed.data } : rest;
    }
    case "origin": {
      const parsed = accessOriginSchema.safeParse(value);
      return parsed.success ? { ...rest, origin: parsed.data } : rest;
    }
    case "state": {
      const parsed = productAccessStateSchema.safeParse(value);
      return parsed.success ? { ...rest, state: parsed.data } : rest;
    }
  }
}

export const resetPeopleListQuery: PeopleListQuery = {};

export const accessStateFilterLabels: Readonly<
  Record<ProductAccessState, string>
> = { active: "Доступ открыт", revoked: "Доступ отозван" };

export interface PeopleFilterChip {
  readonly id: "productId" | "origin" | "state";
  readonly label: string;
  readonly next: PeopleListQuery;
}

/** Плашка на каждый применённый выбор; продукт без названия в каталоге не показывает свой ID. */
export function peopleFilterChips(
  query: PeopleListQuery,
  productName: (productId: string) => string,
): readonly PeopleFilterChip[] {
  const chips: PeopleFilterChip[] = [];
  if (query.productId !== undefined)
    chips.push({
      id: "productId",
      label: productName(query.productId),
      next: withPeopleListFilter(query, "productId", undefined),
    });
  if (query.origin !== undefined)
    chips.push({
      id: "origin",
      label: accessOriginLabels[query.origin],
      next: withPeopleListFilter(query, "origin", undefined),
    });
  if (query.state !== undefined)
    chips.push({
      id: "state",
      label: accessStateFilterLabels[query.state],
      next: withPeopleListFilter(query, "state", undefined),
    });
  return chips;
}

/** Ключ списка под общим префиксом чтений доступа: запись доступа сбрасывает и его. */
export function peopleListQueryKey(query: PeopleListQuery) {
  return [
    ...peopleAccessReadsQueryKey,
    "list",
    serializePeopleListQuery(query, "query"),
  ] as const;
}
