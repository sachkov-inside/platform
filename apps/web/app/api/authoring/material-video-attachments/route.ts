import { handleVideoAttachmentRequest } from "@/features/material-video/api/video-authoring-route.server";

export async function POST(request: Request): Promise<Response> {
  return handleVideoAttachmentRequest(request);
}
