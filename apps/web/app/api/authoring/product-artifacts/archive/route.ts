import { handleSetProductArtifactArchived } from "@/features/product-artifacts.server";

export function PUT(request: Request): Promise<Response> {
  return handleSetProductArtifactArchived(request);
}
