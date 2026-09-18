import { connection } from "next/server";

import { handleAccountPresentationRequest } from "@/_pages/account.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleAccountPresentationRequest();
}
