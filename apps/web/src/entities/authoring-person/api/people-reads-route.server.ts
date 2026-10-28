import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestPeopleIdentities,
  requestPeopleSearch,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import {
  peopleIdentitiesQuerySchema,
  peopleIdentitiesResponseSchema,
  peopleSearchLimitSchema,
  peopleSearchQuerySchema,
  peopleSearchResponseSchema,
  type PeopleIdentitiesState,
  type PeopleSearchState,
} from "../model/people-reads";

const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export interface PeopleReadsDependencies {
  readonly search: typeof requestPeopleSearch;
  readonly identities: typeof requestPeopleIdentities;
}

const productionDependencies: PeopleReadsDependencies = {
  search: requestPeopleSearch,
  identities: requestPeopleIdentities,
};

type Failure = Exclude<PeopleSearchState, { readonly kind: "ready" }>;

/** `GET /api/authoring/people/search?query=&limit=`: поиск людей для владельца. */
export function handlePeopleSearchRequest(
  request: Request,
  dependencies: PeopleReadsDependencies = productionDependencies,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const parameters = new URL(request.url).searchParams;
    const query = peopleSearchQuerySchema.safeParse(
      parameters.get("query") ?? "",
    );
    const limitText = parameters.get("limit");
    const limit =
      limitText === null
        ? { success: true as const, data: undefined }
        : peopleSearchLimitSchema.safeParse(limitText);
    if (!query.success || !limit.success) return invalidRequest();
    const state = await readBackend(
      () =>
        dependencies.search(
          {
            text: query.data,
            ...(limit.data === undefined ? {} : { limit: limit.data }),
          },
          accessToken,
        ),
      (body): PeopleSearchState | undefined => {
        const parsed = peopleSearchResponseSchema.safeParse(body);
        return parsed.success ? { kind: "ready", ...parsed.data } : undefined;
      },
    );
    return respond(state);
  });
}

/** `GET /api/authoring/people/identities?accountIds=a,b`: подписи известных людей для колонки. */
export function handlePeopleIdentitiesRequest(
  request: Request,
  dependencies: PeopleReadsDependencies = productionDependencies,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const accountIds = peopleIdentitiesQuerySchema.safeParse(
      (new URL(request.url).searchParams.get("accountIds") ?? "").split(","),
    );
    if (!accountIds.success) return invalidRequest();
    const state = await readBackend(
      () => dependencies.identities(accountIds.data, accessToken),
      (body): PeopleIdentitiesState | undefined => {
        const parsed = peopleIdentitiesResponseSchema.safeParse(body);
        return parsed.success ? { kind: "ready", ...parsed.data } : undefined;
      },
    );
    return respond(state);
  });
}

function invalidRequest(): Response {
  return Response.json(
    { kind: "unavailable", reference: "invalid-query" },
    { status: 400 },
  );
}

async function readBackend<State extends { readonly kind: string }>(
  read: () => Promise<BackendTransportResult>,
  ready: (body: unknown) => State | undefined,
): Promise<State | Failure> {
  let result: BackendTransportResult;
  try {
    result = await read();
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
        : "people",
    };
  }
  return (
    ready(result.body) ?? {
      kind: "unavailable",
      reference: "malformed-response",
    }
  );
}

function respond(state: {
  readonly kind: string;
  readonly reference?: string;
}) {
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
    ...(state.reference === undefined
      ? {}
      : { headers: { "x-correlation-id": state.reference } }),
  });
}
