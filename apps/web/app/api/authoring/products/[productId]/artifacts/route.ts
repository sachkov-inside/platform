import { connection } from "next/server";

import { handleReadProductArtifactsRequest } from "@/features/product-artifacts.server";

export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ productId: string }> },
): Promise<Response> {
  await connection();
  return handleReadProductArtifactsRequest((await params).productId);
}
