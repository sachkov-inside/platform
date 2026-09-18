import { connection } from "next/server";

import { handleReadGuideArtifactsRequest } from "@/features/guide-artifacts.server";

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ guideId: string }> },
): Promise<Response> {
  await connection();
  return handleReadGuideArtifactsRequest((await params).guideId);
}
