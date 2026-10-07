import { handleReplaceProductArtifactFile } from "@/features/product-artifacts.server";

export function PUT(request: Request): Promise<Response> {
  return handleReplaceProductArtifactFile(request);
}
