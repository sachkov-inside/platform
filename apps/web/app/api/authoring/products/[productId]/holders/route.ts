import { connection } from "next/server";

import { handleProductHoldersRequest } from "@/features/product-holders.server";

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ productId: string }> },
): Promise<Response> {
  await connection();
  return handleProductHoldersRequest(request, (await params).productId);
}
