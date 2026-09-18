import { connection } from "next/server";

import { proxyMaterialAssetDelivery } from "@/features/material-assets.server";

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly assetId: string;
      readonly materialId: string;
      readonly width: string;
    }>;
  },
): Promise<Response> {
  await connection();
  const { assetId, materialId, width } = await context.params;
  return proxyMaterialAssetDelivery(
    request,
    { assetId, materialId, variantWidth: width },
  );
}
