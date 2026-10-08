import { connection } from "next/server";

import { proxyProductTaskAssetDelivery } from "@/_pages/product-task.server";

export async function GET(
  request: Request,
  context: {
    readonly params: Promise<{
      readonly slug: string;
      readonly code: string;
      readonly assetId: string;
    }>;
  },
): Promise<Response> {
  await connection();
  const { slug, code, assetId } = await context.params;
  return proxyProductTaskAssetDelivery(request, {
    productSlug: slug,
    code,
    assetId,
  });
}
