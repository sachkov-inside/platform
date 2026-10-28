import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestPeopleList,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import {
  parsePeopleListQuery,
  peopleListResponseSchema,
  searchParamsRecord,
  type PeopleListQuery,
  type PeopleListState,
} from "../model/people-list";

const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

/** Строк на странице списка людей: середина диапазона 20–50 общего образца. */
export const PEOPLE_LIST_PAGE_SIZE = 25;

export interface PeopleListDependencies {
  readonly list: typeof requestPeopleList;
}

const productionDependencies: PeopleListDependencies = {
  list: requestPeopleList,
};

/** `GET /api/authoring/people?query=&product=&origin=&state=&telegram=&cursor=`: список людей для браузера. */
export function handlePeopleListRequest(
  request: Request,
  dependencies: PeopleListDependencies = productionDependencies,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const query = parsePeopleListQuery(
      searchParamsRecord(new URL(request.url).searchParams),
      { search: "query" },
    );
    const state = await readPeopleList(query, accessToken, dependencies);
    const status =
      state.kind === "ready"
        ? 200
        : state.kind === "invalid_query"
          ? 400
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

export async function readPeopleList(
  query: PeopleListQuery,
  accessToken: string,
  dependencies: PeopleListDependencies = productionDependencies,
): Promise<PeopleListState> {
  let result: BackendTransportResult;
  try {
    result = await dependencies.list(
      {
        limit: PEOPLE_LIST_PAGE_SIZE,
        ...(query.search === undefined ? {} : { query: query.search }),
        ...(query.productId === undefined
          ? {}
          : { productId: query.productId }),
        ...(query.origin === undefined ? {} : { origin: query.origin }),
        ...(query.state === undefined ? {} : { state: query.state }),
        ...(query.telegram === undefined ? {} : { telegram: query.telegram }),
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      },
      accessToken,
    );
  } catch (error) {
    if (error instanceof BackendConnectionError)
      return { kind: "unavailable", reference: error.code };
    throw error;
  }
  if (!result.ok) {
    if (result.response.status === 401) return { kind: "signed_out" };
    if (result.response.status === 403) return { kind: "forbidden" };
    if (result.response.status === 400) return { kind: "invalid_query" };
    const problem = problemSchema.safeParse(result.problem);
    return {
      kind: "unavailable",
      reference: problem.success
        ? (problem.data.correlationId ?? problem.data.code)
        : "people-list",
    };
  }
  const parsed = peopleListResponseSchema.safeParse(result.body);
  return parsed.success
    ? { kind: "ready", ...parsed.data }
    : { kind: "unavailable", reference: "malformed-response" };
}
