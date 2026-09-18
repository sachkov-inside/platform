import { connection } from "next/server";

import { handleBookmarkList } from "@/features/bookmarks.server";

export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleBookmarkList(request);
}
