import { connection } from "next/server";

import { handleStatisticsRead } from "@/_pages/communications.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleStatisticsRead(request);
}
