import { connection } from "next/server";

import { handleReadProductSalesStates } from "@/features/product-sale-settings.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleReadProductSalesStates(request);
}
