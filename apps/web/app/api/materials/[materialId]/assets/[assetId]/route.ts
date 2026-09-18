import { connection } from "next/server";

import { proxyMaterialAssetDelivery } from "@/features/material-assets.server";

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly assetId: string;
      readonly materialId: string;
    }>;
  },
): Promise<Response> {
  await connection();
  const { assetId, materialId } = await context.params;
  return proxyMaterialAssetDelivery(
    request,
    { assetId, materialId },
  );
}
