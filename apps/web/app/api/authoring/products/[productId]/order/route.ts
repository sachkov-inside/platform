import { connection } from "next/server";

import { handleReadProductOrderRequest } from "@/features/product-order.server";
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ productId: string }> },
): Promise<Response> {
  await connection();
  return handleReadProductOrderRequest((await params).productId);
}
