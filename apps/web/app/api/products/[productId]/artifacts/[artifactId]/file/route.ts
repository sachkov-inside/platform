import { connection } from "next/server";

import { proxyReaderProductArtifactFile } from "@/features/product-artifacts.server";

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly artifactId: string;
      readonly productId: string;
    }>;
  },
): Promise<Response> {
  await connection();
  const { artifactId, productId } = await context.params;
  return proxyReaderProductArtifactFile(request, { artifactId, productId });
}
