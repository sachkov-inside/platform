import { connection } from "next/server";

import { handleReadSeriesOrderRequest } from "@/features/series-order.server";
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ productId: string }> },
): Promise<Response> {
  await connection();
  return handleReadSeriesOrderRequest((await params).productId);
}
