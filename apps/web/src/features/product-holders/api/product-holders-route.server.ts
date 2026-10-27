import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestProductHolders,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import {
  parseProductHoldersSearch,
  productHolderSchema,
  type ProductHoldersQuery,
  type ProductHoldersState,
} from "../model/product-holders";

const responseSchema = z
  .object({
    items: z.array(
      productHolderSchema.extend({ revision: z.number().int().positive() }),
    ),
    nextCursor: z.string().nullable(),
  })
  .strict();
const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export interface ProductHoldersDependencies {
  readonly list: typeof requestProductHolders;
}

const productionDependencies: ProductHoldersDependencies = {
  list: requestProductHolders,
};

const statusOf: Record<ProductHoldersState["kind"], number> = {
  ready: 200,
  invalid_request: 400,
  signed_out: 401,
  forbidden: 403,
  not_found: 404,
  unavailable: 503,
};

/** `GET /api/authoring/products/[productId]/holders`: the learners tab and the grant pre-check. */
export function handleProductHoldersRequest(
  request: Request,
  productId: string,
  dependencies: ProductHoldersDependencies = productionDependencies,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const query = parseProductHoldersSearch(
      productId,
      new URL(request.url).searchParams,
    );
    const state: ProductHoldersState =
      query === null
        ? { kind: "invalid_request" }
        : await readProductHolders(query, accessToken, dependencies);
    return Response.json(state, {
      status: statusOf[state.kind],
      ...(state.kind === "unavailable"
        ? { headers: { "x-correlation-id": state.reference } }
        : {}),
    });
  });
}

export async function readProductHolders(
  query: ProductHoldersQuery,
  accessToken: string,
  dependencies: ProductHoldersDependencies = productionDependencies,
): Promise<ProductHoldersState> {
  let result: BackendTransportResult;
  try {
    result = await dependencies.list(
      {
        productId: query.productId,
        ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        ...(query.access === undefined ? {} : { access: query.access }),
        ...(query.accountIds === undefined
          ? {}
          : { accountIds: [...query.accountIds] }),
      },
      accessToken,
    );
  } catch (error) {
    if (error instanceof BackendConnectionError)
      return { kind: "unavailable", reference: error.code };
    throw error;
  }
  if (!result.ok) {
    const status = result.response.status;
    if (status === 401) return { kind: "signed_out" };
    if (status === 403) return { kind: "forbidden" };
    if (status === 404) return { kind: "not_found" };
    // A cursor from another filter or a stale address: the tab starts over from the first page.
    if (status === 400) return { kind: "invalid_request" };
    const problem = problemSchema.safeParse(result.problem);
    return {
      kind: "unavailable",
      reference: problem.success
        ? (problem.data.correlationId ?? problem.data.code)
        : "product-holders",
    };
  }
  const parsed = responseSchema.safeParse(result.body);
  if (!parsed.success)
    return { kind: "unavailable", reference: "malformed-response" };
  return {
    kind: "ready",
    items: parsed.data.items.map(
      ({ accountId, access, firstIssuedAt, learning }) => ({
        accountId,
        access,
        firstIssuedAt,
        learning,
      }),
    ),
    nextCursor: parsed.data.nextCursor,
  };
}
