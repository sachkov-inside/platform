import { connection } from "next/server";
import { handleOwnerPriceCatalogRead } from "@/entities/subscription.server";

export async function GET(): Promise<Response> {
  await connection();
  return handleOwnerPriceCatalogRead();
}
