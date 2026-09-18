import { connection } from "next/server";

import { handleSavedPostList } from "@/_pages/communications.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleSavedPostList(request);
}
