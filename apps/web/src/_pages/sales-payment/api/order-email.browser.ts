import {
  requestOwnerRead,
  type OwnerReadState,
} from "@/features/owner-payments";

import { orderEmailSchema, type OrderEmail } from "../model/order-email";

export function requestOrderEmail(
  purchaseRef: string,
  signal?: AbortSignal,
): Promise<OwnerReadState<OrderEmail>> {
  return requestOwnerRead(
    `/api/authoring/billing/owner-payments/${encodeURIComponent(purchaseRef)}/order-email`,
    orderEmailSchema,
    signal,
  );
}
