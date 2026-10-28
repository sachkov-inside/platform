import { z } from "zod";
import type { Route } from "next";

import { materialFormatSchema } from "@/shared/api/material-format";
import {
  authoringMaterialsRootHref,
  withAuthoringReturnHref,
} from "@/shared/routing/authoring";

import type {
  AuthoringMaterialFilterOptions,
  AuthoringMaterialListItem,
  AuthoringMaterialsQuery,
  MaterialPublicationState,
} from "./authoring-materials-presentation";

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);
export { authoringMaterialsRootHref };

export type AuthoringMaterialsSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export function parseAuthoringMaterialsQuery(
  searchParams: AuthoringMaterialsSearchParams,
): AuthoringMaterialsQuery {
  const pageInput = single(searchParams["page"]);
  const page = z.coerce.number().int().min(1).max(10_000).safeParse(pageInput);
  const stateInput = single(searchParams["state"]);
  const publicationState = publicationStateSchema.safeParse(stateInput);
  const searchInput = single(searchParams["search"]);
  const search = z
    .string()
    .trim()
    .min(1)
    .max(160)
    .transform((value) => value.replace(/\s+/gu, " "))
    .safeParse(searchInput);
  const topicId = z.uuid().safeParse(single(searchParams["topic"]));
  const format = materialFormatSchema.safeParse(single(searchParams["format"]));

  return {
    page: page.success ? page.data : 1,
    ...(publicationState.success
      ? { publicationState: publicationState.data }
      : {}),
    ...(search.success ? { search: search.data } : {}),
    ...(topicId.success ? { topicId: topicId.data } : {}),
    ...(format.success ? { format: format.data } : {}),
  };
}

export function authoringMaterialsHref(
  query: AuthoringMaterialsQuery,
  page = query.page,
): Route {
  const serialized = serializeAuthoringMaterialsQuery({ ...query, page });
  return serialized === ""
    ? authoringMaterialsRootHref
    : `${authoringMaterialsRootHref}?${serialized}`;
}

export function parseAuthoringMaterialsUrlSearchParams(
  searchParams: URLSearchParams,
): AuthoringMaterialsQuery {
  const values: Record<string, string | readonly string[] | undefined> = {};
  for (const key of new Set(searchParams.keys())) {
    const all = searchParams.getAll(key);
    values[key] = all.length === 1 ? all[0] : all;
  }
  return parseAuthoringMaterialsQuery(values);
}

export function serializeAuthoringMaterialsQuery(
  query: AuthoringMaterialsQuery,
): string {
  const params = new URLSearchParams();
  if (query.search !== undefined) params.set("search", query.search);
  if (query.publicationState !== undefined) {
    params.set("state", query.publicationState);
  }
  if (query.topicId !== undefined) params.set("topic", query.topicId);
  if (query.format !== undefined) params.set("format", query.format);
  if (query.page > 1) params.set("page", String(query.page));
  return params.toString();
}

export const authoringDestinationHref = withAuthoringReturnHref;

/** Search, state, Topic or format narrows the list; the page number alone does not. */
export function hasAuthoringMaterialsFilters(
  query: AuthoringMaterialsQuery,
): boolean {
  return (
    query.search !== undefined ||
    query.publicationState !== undefined ||
    query.topicId !== undefined ||
    query.format !== undefined
  );
}

type FilterKey = "format" | "publicationState" | "search" | "topicId";

/**
 * The query after the author changed one filter: an empty value removes it, and any change
 * returns to the first page, because the old page number belongs to another set.
 */
export function withAuthoringMaterialsFilter(
  query: AuthoringMaterialsQuery,
  key: FilterKey,
  value: string | undefined,
): AuthoringMaterialsQuery {
  const { [key]: _removed, ...rest } = query;
  const next: AuthoringMaterialsQuery = { ...rest, page: 1 };
  if (value === undefined || value === "") return next;
  switch (key) {
    // The field keeps what the author typed; the request normalises it (`parseAuthoringMaterialsQuery`).
    case "search":
      return { ...next, search: value };
    case "publicationState": {
      const parsed = publicationStateSchema.safeParse(value);
      return parsed.success ? { ...next, publicationState: parsed.data } : next;
    }
    case "topicId": {
      const parsed = z.uuid().safeParse(value);
      return parsed.success ? { ...next, topicId: parsed.data } : next;
    }
    case "format": {
      const parsed = materialFormatSchema.safeParse(value);
      return parsed.success ? { ...next, format: parsed.data } : next;
    }
  }
}

/** «Сбросить»: every filter and the page go, the list starts over. */
export const resetAuthoringMaterialsQuery: AuthoringMaterialsQuery = {
  page: 1,
};

export const publicationStateFilterLabels: Readonly<
  Record<MaterialPublicationState, string>
> = {
  draft: "Черновики",
  published: "Опубликованные",
  unpublished: "Снятые с публикации",
};

export interface AuthoringMaterialsFilterChip {
  readonly id: "format" | "publicationState" | "topicId";
  readonly label: string;
  /** The query after this chip is removed. */
  readonly next: AuthoringMaterialsQuery;
}

/**
 * One chip per applied choice filter. Search stays in its own field with its own clear button;
 * «Сбросить» removes it together with the chips. A Topic or format the choices do not name yet
 * (still loading, unavailable or archived away) keeps a neutral label rather than its id.
 */
export function authoringMaterialsFilterChips(
  query: AuthoringMaterialsQuery,
  options: AuthoringMaterialFilterOptions,
): readonly AuthoringMaterialsFilterChip[] {
  const chips: AuthoringMaterialsFilterChip[] = [];
  if (query.publicationState !== undefined)
    chips.push({
      id: "publicationState",
      label: publicationStateFilterLabels[query.publicationState],
      next: withAuthoringMaterialsFilter(query, "publicationState", undefined),
    });
  if (query.topicId !== undefined)
    chips.push({
      id: "topicId",
      label: topicFilterLabel(query.topicId, options),
      next: withAuthoringMaterialsFilter(query, "topicId", undefined),
    });
  if (query.format !== undefined)
    chips.push({
      id: "format",
      label: formatFilterLabel(query.format, options),
      next: withAuthoringMaterialsFilter(query, "format", undefined),
    });
  return chips;
}

export function topicFilterLabel(
  topicId: string,
  options: AuthoringMaterialFilterOptions,
): string {
  return options.kind === "ready"
    ? (options.topics.find((topic) => topic.value === topicId)?.label ??
        "Выбранная тема")
    : "Выбранная тема";
}

export function formatFilterLabel(
  format: string,
  options: AuthoringMaterialFilterOptions,
): string {
  return options.kind === "ready"
    ? (options.formats.find((option) => option.value === format)?.label ??
        "Выбранный формат")
    : "Выбранный формат";
}

/** «21–40 из 57» under the table; nothing when the page holds no rows. */
export function authoringMaterialsPageSummary(state: {
  readonly items: readonly unknown[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
}): string | undefined {
  if (state.items.length === 0) return undefined;
  const first = (state.page - 1) * state.pageSize + 1;
  const last = first + state.items.length - 1;
  return `${String(first)}–${String(last)} из ${String(state.totalItems)}`;
}

/** What a saved publication change told the list about one Material. */
export interface MaterialPublicationReceipt {
  readonly contentVersion: number;
  readonly publicationState: "published" | "unpublished";
  readonly submissionId: string;
}

/**
 * A row after its last publication change. The receipt wins only while the list still shows an
 * older version: once the re-read brings that version or a newer one, the server row is the fact.
 * A published or unpublished Material is no longer a never-published draft, so it cannot be deleted.
 */
export function withPublicationReceipt(
  item: AuthoringMaterialListItem,
  receipt: MaterialPublicationReceipt | undefined,
): AuthoringMaterialListItem {
  if (receipt === undefined || receipt.contentVersion <= item.contentVersion)
    return item;
  return {
    ...item,
    canDelete: false,
    contentVersion: receipt.contentVersion,
    publicationState: receipt.publicationState,
    submissionId: receipt.submissionId,
  };
}

function single(
  value: string | readonly string[] | undefined,
): string | undefined {
  return typeof value === "string" ? value : undefined;
}
