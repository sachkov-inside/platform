import "server-only";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";
import { getProductOrder } from "./get-product-order";
import { hasText } from "@/shared/lib/text";
export async function handleReadProductOrderRequest(
  productId: string,
): Promise<Response> {
  const headers = { "cache-control": "private, no-store" };
  try {
    const token = await getOptionalPlatformAccessToken();
    return Response.json(
      hasText(token)
        ? await getProductOrder(productId, token)
        : { kind: "unauthorized" },
      { headers },
    );
  } catch {
    return Response.json(
      { kind: "error", reference: "product-order-session" },
      { headers },
    );
  }
}
