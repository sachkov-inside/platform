import { handleCreateProductArtifactFile } from "@/features/product-artifacts.server";

export function POST(request: Request): Promise<Response> {
  return handleCreateProductArtifactFile(request);
}
