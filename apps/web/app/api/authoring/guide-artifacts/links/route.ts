import { handleCreateGuideArtifactLink } from "@/features/guide-artifacts.server";

export function POST(request: Request): Promise<Response> {
  return handleCreateGuideArtifactLink(request);
}
