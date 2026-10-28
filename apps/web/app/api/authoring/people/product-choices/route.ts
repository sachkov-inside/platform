import { connection } from "next/server";

import { handleAccessProductCatalogRequest } from "@/features/product-access-actions.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleAccessProductCatalogRequest();
}
