import { handleProductTopicsRequest } from "@/features/product-order.server";
export function PUT(request: Request): Promise<Response> {
  return handleProductTopicsRequest(request);
}
