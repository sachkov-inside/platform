import { handleSaveProductSalesState } from "@/features/product-sale-settings.server";
export function POST(request: Request): Promise<Response> {
  return handleSaveProductSalesState(request);
}
