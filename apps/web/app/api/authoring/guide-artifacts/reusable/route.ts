import { handleReadReusableGuideArtifactsRequest } from "@/features/guide-artifacts.server";

export function GET(): Promise<Response> {
  return handleReadReusableGuideArtifactsRequest();
}
