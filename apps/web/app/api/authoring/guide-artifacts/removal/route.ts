import { handleRemoveGuideArtifact } from "@/features/guide-artifacts.server";

export function DELETE(request: Request): Promise<Response> {
  return handleRemoveGuideArtifact(request);
}
