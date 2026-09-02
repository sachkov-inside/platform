import { handleVideoDeletionRetryRequest } from "@/features/material-video/api/video-authoring-route.server";

export function POST(request: Request): Promise<Response> {
  return handleVideoDeletionRetryRequest(request);
}
