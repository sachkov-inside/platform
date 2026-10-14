import { connection } from "next/server";
import { handleRestoreProductPurchase } from "@/features/billing-checkout.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleRestoreProductPurchase(request);
}
