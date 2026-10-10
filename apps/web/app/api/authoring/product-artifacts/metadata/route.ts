import { handleUpdateProductArtifact } from "@/features/product-artifacts.server";

export function PATCH(request: Request): Promise<Response> {
  return handleUpdateProductArtifact(request);
}
