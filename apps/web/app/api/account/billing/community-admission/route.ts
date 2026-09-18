import { connection } from "next/server";

import { handleCurrentCommunityAdmission } from "@/features/billing-subscription.server";
export async function GET(): Promise<Response> {
  await connection();
  return handleCurrentCommunityAdmission();
}
