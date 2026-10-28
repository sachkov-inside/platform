import { connection } from "next/server";

import { handleOwnerPaymentProductsRequest } from "@/features/owner-payments.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleOwnerPaymentProductsRequest();
}
