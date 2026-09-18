import { connection } from "next/server";

import { handleFunnelList } from "@/_pages/communications.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleFunnelList(request);
}
