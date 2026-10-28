import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestAuthoringSearch,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import {
  authoringSearchQuerySchema,
  searchResponseSchema,
  type AuthoringSearchState,
} from "../model/authoring-search";

const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export interface AuthoringSearchDependencies {
  readonly search: typeof requestAuthoringSearch;
}

const productionDependencies: AuthoringSearchDependencies = {
  search: requestAuthoringSearch,
};

/** `GET /api/authoring/search?query=`: общий поиск админки для браузера. */
export async function handleAuthoringSearchRequest(
  request: Request,
  dependencies: AuthoringSearchDependencies = productionDependencies,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const query = authoringSearchQuerySchema.safeParse(
      new URL(request.url).searchParams.get("query") ?? "",
    );
    if (!query.success)
      return Response.json(
        { kind: "unavailable", reference: "invalid-query" },
        { status: 400 },
      );
    const state = await searchAuthoring(query.data, accessToken, dependencies);
    const status =
      state.kind === "ready"
        ? 200
        : state.kind === "signed_out"
          ? 401
          : state.kind === "forbidden"
            ? 403
            : 503;
    return Response.json(state, {
      status,
      ...(state.kind === "unavailable"
        ? { headers: { "x-correlation-id": state.reference } }
        : {}),
    });
  });
}

export async function searchAuthoring(
  query: string,
  accessToken: string,
  dependencies: AuthoringSearchDependencies = productionDependencies,
): Promise<AuthoringSearchState> {
  let result: BackendTransportResult;
  try {
    result = await dependencies.search(query, accessToken);
  } catch (error) {
    if (error instanceof BackendConnectionError)
      return { kind: "unavailable", reference: error.code };
    throw error;
  }
  if (!result.ok) {
    if (result.response.status === 401) return { kind: "signed_out" };
    if (result.response.status === 403) return { kind: "forbidden" };
    const problem = problemSchema.safeParse(result.problem);
    return {
      kind: "unavailable",
      reference: problem.success
        ? (problem.data.correlationId ?? problem.data.code)
        : "search",
    };
  }
  const parsed = searchResponseSchema.safeParse(result.body);
  if (!parsed.success)
    return { kind: "unavailable", reference: "malformed-response" };
  return { kind: "ready", groups: parsed.data.groups };
}
