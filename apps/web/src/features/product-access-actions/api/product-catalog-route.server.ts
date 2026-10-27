import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestMaterialAuthoringReferences,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import {
  sortAccessProducts,
  type AccessProductCatalog,
} from "../model/product-catalog";

/** Из справочника берутся только продукты: темы, форматы и теги остаются редактору. */
const referencesSchema = z
  .object({
    products: z.array(
      z
        .object({
          archived: z.boolean(),
          id: z.uuid(),
          name: z.string().min(1),
        })
        .strict(),
    ),
  })
  .loose();
const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export interface AccessProductCatalogDependencies {
  readonly references: typeof requestMaterialAuthoringReferences;
}

const productionDependencies: AccessProductCatalogDependencies = {
  references: requestMaterialAuthoringReferences,
};

/** `GET /api/authoring/access/products/catalog`: продукты для выдачи и фильтра людей. */
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
    result = await dependencies.references(accessToken);
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
  const parsed = referencesSchema.safeParse(result.body);
  if (!parsed.success)
    return { kind: "unavailable", reference: "malformed-response" };
  return {
    kind: "ready",
    products: sortAccessProducts(
      parsed.data.products.map((product) => ({
        archived: product.archived,
        name: product.name,
        productId: product.id,
      })),
    ),
  };
}
