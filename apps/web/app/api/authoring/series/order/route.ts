import { handleSeriesOrderRequest } from "@/_pages/series-order.server";

export function PUT(request: Request): Promise<Response> {
  return handleSeriesOrderRequest(request);
}
