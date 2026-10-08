import { handleSetProductArtifactProducts } from "@/features/product-artifacts.server";

export function PUT(request: Request): Promise<Response> {
  return handleSetProductArtifactProducts(request);
}
