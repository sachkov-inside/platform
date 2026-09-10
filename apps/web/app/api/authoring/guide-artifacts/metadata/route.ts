import { handleUpdateGuideArtifact } from "@/features/guide-artifacts.server";

export function PATCH(request: Request): Promise<Response> {
  return handleUpdateGuideArtifact(request);
}
