import { handleCreateGuideArtifactFile } from "@/features/guide-artifacts.server";

export function POST(request: Request): Promise<Response> {
  return handleCreateGuideArtifactFile(request);
}
