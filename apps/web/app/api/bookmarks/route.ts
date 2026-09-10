import { handleBookmarkList } from "@/features/bookmarks.server";

export async function GET(request: Request): Promise<Response> {
  return handleBookmarkList(request);
}
