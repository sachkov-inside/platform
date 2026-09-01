import {
  handleVideoPlaybackRequest,
  handleVideoProgressRequest,
} from "@/features/material-video/api/video-playback-route.server";

export async function POST(request: Request): Promise<Response> {
  return handleVideoPlaybackRequest(request);
}

export async function PUT(request: Request): Promise<Response> {
  return handleVideoProgressRequest(request);
}
