import "server-only";

import {
  billingFailureCode,
  billingFailureResponse,
  privateBillingHeaders,
} from "@/entities/subscription.server";
import {
  requestOwnerOrderEmail,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";
import { handleAuthenticatedRead } from "@/shared/auth/index.server";

import { orderEmailSchema } from "../model/order-email";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * `GET /api/authoring/billing/owner-payments/:purchaseRef/order-email`: email заказа одной страницы
 * платежа. Ответ личный и не кешируется; адрес не попадает ни в журнал, ни в текст ошибки.
 */
export function handleOrderEmailRequest(
  purchaseRef: string,
): Promise<Response> {
  return handleAuthenticatedRead(async (accessToken) => {
    if (!uuidPattern.test(purchaseRef))
      return billingFailureResponse("not_found", 404);
    let result: BackendTransportResult;
    try {
      result = await requestOwnerOrderEmail(
        purchaseRef.toLowerCase(),
        accessToken,
      );
    } catch {
      return billingFailureResponse("unavailable", 503);
    }
    if (!result.ok)
      return billingFailureResponse(
        billingFailureCode(result),
        result.response.status,
      );
    const parsed = orderEmailSchema.safeParse(result.body);
    return parsed.success
      ? Response.json(
          { ok: true, value: { email: parsed.data.email } },
          { headers: privateBillingHeaders },
        )
      : billingFailureResponse("unavailable", 502);
  });
}
