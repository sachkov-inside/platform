import { connection } from "next/server";
import {
  handleReadProductCommunityConfiguration,
  handleConfigureProductCommunity,
} from "@/features/product-community-settings.server";
export async function GET(request: Request): Promise<Response> {
  await connection();
  return handleReadProductCommunityConfiguration(request);
}
export function PUT(request: Request): Promise<Response> {
  return handleConfigureProductCommunity(request);
}
