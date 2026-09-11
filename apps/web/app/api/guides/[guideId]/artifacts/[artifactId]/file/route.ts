import { proxyReaderGuideArtifactFile } from "@/features/guide-artifacts.server";

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly artifactId: string;
      readonly guideId: string;
    }>;
  },
): Promise<Response> {
  const { artifactId, guideId } = await context.params;
  return proxyReaderGuideArtifactFile(request, { artifactId, guideId });
}
