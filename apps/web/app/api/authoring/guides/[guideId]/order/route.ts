import { handleReadSeriesOrderRequest } from "@/features/series-order.server";
export async function GET(
  _request: Request,
  { params }: { readonly params: Promise<{ guideId: string }> },
): Promise<Response> {
  return handleReadSeriesOrderRequest((await params).guideId);
}
