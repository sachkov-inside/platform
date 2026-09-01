import { z } from "zod";
import type { Route } from "next";

import {
  authoringMaterialsRootHref,
  withAuthoringReturnHref,
} from "@/shared/routing/authoring";

import type { AuthoringMaterialsQuery } from "./authoring-materials-presentation";

const publicationStateSchema = z.enum(["draft", "published", "unpublished"]);
export { authoringMaterialsRootHref };

export type AuthoringMaterialsSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export function parseAuthoringMaterialsQuery(
  searchParams: AuthoringMaterialsSearchParams,
): AuthoringMaterialsQuery {
  const pageInput = single(searchParams.page);
  const page = z.coerce.number().int().min(1).max(10_000).safeParse(pageInput);
  const stateInput = single(searchParams.state);
  const publicationState = publicationStateSchema.safeParse(stateInput);
  const searchInput = single(searchParams.search);
  const search = z
    .string()
    .trim()
    .min(1)
    .max(160)
    .transform((value) => value.replace(/\s+/gu, " "))
    .safeParse(searchInput);

  return {
    page: page.success ? page.data : 1,
    ...(publicationState.success
      ? { publicationState: publicationState.data }
      : {}),
    ...(search.success ? { search: search.data } : {}),
  };
}

export function authoringMaterialsHref(
  query: AuthoringMaterialsQuery,
  page = query.page,
): Route {
  const params = new URLSearchParams();
  if (query.search !== undefined) params.set("search", query.search);
  if (query.publicationState !== undefined) {
    params.set("state", query.publicationState);
  }
  if (page > 1) params.set("page", String(page));
  const serialized = params.toString();
  return serialized === ""
    ? authoringMaterialsRootHref
    : `${authoringMaterialsRootHref}?${serialized}`;
}

export const authoringDestinationHref = withAuthoringReturnHref;

function single(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}
