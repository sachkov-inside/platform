import { connection } from "next/server";

import { handleOwnerPaymentRequest } from "@/features/owner-payments.server";

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ readonly purchaseRef: string }> },
): Promise<Response> {
  await connection();
  const { purchaseRef } = await params;
  return handleOwnerPaymentRequest(request, purchaseRef);
}
