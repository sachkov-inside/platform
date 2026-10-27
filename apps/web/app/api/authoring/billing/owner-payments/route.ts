import { connection } from "next/server";

import { handleOwnerPaymentsRequest } from "@/features/owner-payments.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleOwnerPaymentsRequest(request);
}
