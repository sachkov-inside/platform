import "server-only";

import { handleMutationOperation } from "@/shared/auth/index.server";

import {
  executeReorderSeries,
  reorderSeriesInvalidInput,
} from "./reorder-series.server";
import { reorderSeriesOperation } from "./series-order.operation";

export function handleSeriesOrderRequest(request: Request): Promise<Response> {
  return handleMutationOperation(request, reorderSeriesOperation, {
    execute: (input, accessToken) => executeReorderSeries(input, accessToken),
    invalidInput: reorderSeriesInvalidInput,
  });
}
