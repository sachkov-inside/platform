import { handleChapterAttachmentsRequest } from "@/features/series-order.server";
export function PUT(request: Request): Promise<Response> {
  return handleChapterAttachmentsRequest(request);
}
