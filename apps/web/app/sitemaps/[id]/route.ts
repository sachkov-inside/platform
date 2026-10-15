import { connection } from "next/server";
import { getPublicSitemapResponse } from "@/features/public-site-index.server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  await connection();
  return getPublicSitemapResponse((await context.params).id);
}
