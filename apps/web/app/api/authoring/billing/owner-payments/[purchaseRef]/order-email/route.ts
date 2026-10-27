import { connection } from "next/server";

import { handleOrderEmailRequest } from "@/_pages/sales-payment.server";

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ readonly purchaseRef: string }> },
): Promise<Response> {
  await connection();
  const { purchaseRef } = await params;
  return handleOrderEmailRequest(purchaseRef);
}
