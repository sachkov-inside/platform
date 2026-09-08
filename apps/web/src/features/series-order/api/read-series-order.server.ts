import "server-only";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";
import { getSeriesOrder } from "./get-series-order";
export async function handleReadSeriesOrderRequest(
  seriesId: string,
): Promise<Response> {
  const headers = { "cache-control": "private, no-store" };
  try {
    const token = await getOptionalPlatformAccessToken();
    return Response.json(
      token ? await getSeriesOrder(seriesId, token) : { kind: "unauthorized" },
      { headers },
    );
  } catch {
    return Response.json(
      { kind: "error", reference: "series-order-session" },
      { headers },
    );
  }
}
