import { handleReadGuideArtifactsRequest } from "@/features/guide-artifacts.server";

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ guideId: string }> },
): Promise<Response> {
  return handleReadGuideArtifactsRequest((await params).guideId);
}
