import { z } from "zod";

import { reportDependencyFailure } from "../../../../infrastructure/observability/index.js";
import type {
  AuthoringSearchGroup,
  AuthoringSearchKind,
  AuthoringSearchReadyGroup,
} from "../../ports/authoring-search-group.js";

export const AUTHORING_SEARCH = Symbol("AUTHORING_SEARCH");

/** The most hits one group returns. */
export const AUTHORING_SEARCH_GROUP_LIMIT = 5;

/** The longest search text, counted after trimming. */
export const AUTHORING_SEARCH_QUERY_MAX_CHARACTERS = 160;

/** The search text: trimmed, 1–160 characters, whitespace runs collapsed to one space. */
const authoringSearchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(AUTHORING_SEARCH_QUERY_MAX_CHARACTERS)
  .transform((value) => value.replace(/\s+/gu, " "));

export type AuthoringSearchGroupAnswer =
  | AuthoringSearchReadyGroup
  | { readonly kind: AuthoringSearchKind; readonly state: "unavailable" };

export type SearchAuthoringResult =
  | {
      readonly ok: true;
      readonly value: {
        readonly groups: readonly AuthoringSearchGroupAnswer[];
      };
    }
  | {
      readonly ok: false;
      readonly error:
        | { readonly code: "invalid_request_shape" }
        | { readonly code: "forbidden" };
    };

/**
 * The authoring search over every group the actor may read (#1720), in registry order. Each group
 * answers with at most five hits or as unavailable; a group the actor may not read is omitted.
 * An actor who may read no group is refused, never answered with empty groups.
 */
export interface AuthoringSearch {
  readonly search: (
    actorId: string,
    query: unknown,
  ) => Promise<SearchAuthoringResult>;
}

/** `groups` is the registry: see `AuthoringSearchGroup` for adding one. */
export function assembleAuthoringSearch(
  groups: readonly AuthoringSearchGroup[],
): AuthoringSearch {
  return Object.freeze<AuthoringSearch>({
    search: async (actorId, query) => {
      const parsed = authoringSearchQuerySchema.safeParse(query);
      if (!parsed.success)
        return { ok: false, error: { code: "invalid_request_shape" } };
      const request = {
        actor: actorId,
        query: parsed.data,
        limit: AUTHORING_SEARCH_GROUP_LIMIT,
      };
      const answers = await Promise.all(
        groups.map((group) => answerOf(group, request)),
      );
      const readable = answers.filter((answer) => answer !== "forbidden");
      return readable.length === 0
        ? { ok: false, error: { code: "forbidden" } }
        : { ok: true, value: { groups: readable } };
    },
  });
}

async function answerOf(
  group: AuthoringSearchGroup,
  request: Parameters<AuthoringSearchGroup["search"]>[0],
): Promise<AuthoringSearchGroupAnswer | "forbidden"> {
  try {
    const result = await group.search(request);
    if (result.ok) return result.value;
    // The owner already recorded its dependency failure; a refusal is an answer, not a failure.
    return result.error.code === "forbidden"
      ? "forbidden"
      : { kind: group.kind, state: "unavailable" };
  } catch (error) {
    reportDependencyFailure(
      { module: "authoring-search", operation: "searchAuthoring" },
      error,
    );
    return { kind: group.kind, state: "unavailable" };
  }
}
