import { handleRemoveProductArtifact } from "@/features/product-artifacts.server";

export function DELETE(request: Request): Promise<Response> {
  return handleRemoveProductArtifact(request);
}
