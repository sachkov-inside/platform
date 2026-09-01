import { proxyMaterialAssetUpload } from "@/features/material-assets.server";

export async function POST(
  request: Request,
  context: { readonly params: Promise<{ readonly materialId: string }> },
): Promise<Response> {
  const { materialId } = await context.params;
  return proxyMaterialAssetUpload(request, materialId);
}
