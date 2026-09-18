import { connection } from "next/server";

import { handleCurrentEnrollments } from "@/features/billing-subscription.server";
export async function GET(): Promise<Response> {
  await connection();
  return handleCurrentEnrollments();
}
