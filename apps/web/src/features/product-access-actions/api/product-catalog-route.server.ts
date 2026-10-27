import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestPeopleProductChoices,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import {
  accessProductSchema,
  sortAccessProducts,
  type AccessProductCatalog,
} from "../model/product-catalog";

const choicesSchema = z
  .object({ items: z.array(accessProductSchema) })
  .strict();
const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export interface AccessProductCatalogDependencies {
  readonly choices: typeof requestPeopleProductChoices;
}

const productionDependencies: AccessProductCatalogDependencies = {
  choices: requestPeopleProductChoices,
};

/** `GET /api/authoring/people/product-choices`: продукты для выдачи и фильтра людей. */
export function handleAccessProductCatalogRequest(
  dependencies: AccessProductCatalogDependencies = productionDependencies,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const state = await readCatalog(accessToken, dependencies);
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

async function readCatalog(
  accessToken: string,
  dependencies: AccessProductCatalogDependencies,
): Promise<AccessProductCatalog> {
  let result: BackendTransportResult;
  try {
    result = await dependencies.choices(accessToken);
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
        : "product-catalog",
    };
  }
  const parsed = choicesSchema.safeParse(result.body);
  if (!parsed.success)
    return { kind: "unavailable", reference: "malformed-response" };
  return { kind: "ready", products: sortAccessProducts(parsed.data.items) };
}
