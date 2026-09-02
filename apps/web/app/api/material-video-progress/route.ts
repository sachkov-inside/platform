import { handleVideoProgressSaveRequest } from "@/features/material-video/api/video-playback-route.server";

export async function PUT(request: Request): Promise<Response> {
  return handleVideoProgressSaveRequest(request);
}
