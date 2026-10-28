import { connection } from "next/server";

import { handleProductOverviewRequest } from "@/features/admin-overview.server";

export async function GET(
  request: Request,
  { params }: { readonly params: Promise<{ productId: string }> },
): Promise<Response> {
  await connection();
  return handleProductOverviewRequest(request, (await params).productId);
}
