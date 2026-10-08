import { connection } from "next/server";

import { handleReadReusableProductArtifactsRequest } from "@/features/product-artifacts.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleReadReusableProductArtifactsRequest();
}
