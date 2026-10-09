import "server-only";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import { executeReorderSeries } from "./reorder-series.server";

export function handleSeriesOrderRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeReorderSeries);
}
