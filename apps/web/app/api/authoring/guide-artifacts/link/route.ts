import { handleReplaceGuideArtifactLink } from "@/features/guide-artifacts.server";

export function PUT(request: Request): Promise<Response> {
  return handleReplaceGuideArtifactLink(request);
}
