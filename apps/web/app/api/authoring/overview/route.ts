import { connection } from "next/server";

import { handleOverviewRequest } from "@/_pages/authoring-overview.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleOverviewRequest(request);
}
