import { connection } from "next/server";

import { handleBroadcastList } from "@/_pages/communications.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleBroadcastList(request);
}
