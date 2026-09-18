import { connection } from "next/server";

import { handleBillingPurchaseStatus } from "@/features/billing-checkout.server";
export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleBillingPurchaseStatus(request);
}
