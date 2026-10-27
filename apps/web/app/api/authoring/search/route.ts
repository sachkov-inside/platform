import { connection } from "next/server";

import { handleAuthoringSearchRequest } from "@/features/authoring-search.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleAuthoringSearchRequest(request);
}
