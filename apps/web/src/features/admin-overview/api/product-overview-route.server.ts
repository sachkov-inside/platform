import "server-only";

import { z } from "zod";

import {
  BackendConnectionError,
  requestProductOverview,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import {
  parseOverviewPeriod,
  type OverviewPeriodDays,
} from "../model/overview-contract";
import {
  productOverviewSchema,
  type ProductOverviewState,
} from "../model/product-overview";

const problemSchema = z
  .object({ code: z.string(), correlationId: z.string().optional() })
  .loose();

export interface ProductOverviewDependencies {
  readonly read: typeof requestProductOverview;
}

const productionDependencies: ProductOverviewDependencies = {
  read: requestProductOverview,
};

const statuses = {
  ready: 200,
  signed_out: 401,
  forbidden: 403,
  not_found: 404,
  unavailable: 503,
} as const;

/** `GET /api/authoring/products/:productId/overview?period=`: Обзор продукта для браузера. */
export function handleProductOverviewRequest(
  request: Request,
  productId: string,
  dependencies: ProductOverviewDependencies = productionDependencies,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    const period = parseOverviewPeriod(
      new URL(request.url).searchParams.get("period"),
    );
    const state: ProductOverviewState = z.uuid().safeParse(productId).success
      ? await readProductOverview(productId, period, accessToken, dependencies)
      : { kind: "not_found" };
    return Response.json(state, {
      status: statuses[state.kind],
      ...(state.kind === "unavailable"
        ? { headers: { "x-correlation-id": state.reference } }
        : {}),
    });
  });
}

async function readProductOverview(
  productId: string,
  period: OverviewPeriodDays,
  accessToken: string,
  dependencies: ProductOverviewDependencies,
): Promise<ProductOverviewState> {
  let result: BackendTransportResult;
  try {
    result = await dependencies.read(productId, period, accessToken);
  } catch (error) {
    if (error instanceof BackendConnectionError)
      return { kind: "unavailable", reference: error.code };
    throw error;
  }
  if (!result.ok) {
    if (result.response.status === 401) return { kind: "signed_out" };
    if (result.response.status === 403) return { kind: "forbidden" };
    if (result.response.status === 404) return { kind: "not_found" };
    const problem = problemSchema.safeParse(result.problem);
    return {
      kind: "unavailable",
      reference: problem.success
        ? (problem.data.correlationId ?? problem.data.code)
        : "product-overview",
    };
  }
  const parsed = productOverviewSchema.safeParse(result.body);
  return parsed.success
    ? { kind: "ready", ...parsed.data }
    : { kind: "unavailable", reference: "malformed-response" };
}
