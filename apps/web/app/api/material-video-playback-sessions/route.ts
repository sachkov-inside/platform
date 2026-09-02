import { handleVideoPlaybackSessionRequest } from "@/features/material-video/api/video-playback-route.server";

export async function POST(request: Request): Promise<Response> {
  return handleVideoPlaybackSessionRequest(request);
}
