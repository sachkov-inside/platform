import { connection } from "next/server";

import { handleCurrentBilling } from "@/features/billing-subscription.server";
export async function GET(): Promise<Response> {
  await connection();
  return handleCurrentBilling();
}
