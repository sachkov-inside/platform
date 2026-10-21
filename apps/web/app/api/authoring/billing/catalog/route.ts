import { connection } from "next/server";
import { handleOwnerCatalogRead } from "@/features/billing-admin.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleOwnerCatalogRead();
}
