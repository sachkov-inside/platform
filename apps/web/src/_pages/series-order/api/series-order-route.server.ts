import "server-only";

import { handleAuthenticatedMutation } from "@/shared/auth/index.server";

import { executeReorderSeries } from "./reorder-series";

export function handleSeriesOrderRequest(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, executeReorderSeries);
}
