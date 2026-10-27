import { handleProductOrderRequest } from "@/features/product-order.server";

export function PUT(request: Request): Promise<Response> {
  return handleProductOrderRequest(request);
}
