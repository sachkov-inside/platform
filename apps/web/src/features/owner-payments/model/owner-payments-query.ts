import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import {
  requestOwnerPayment,
  requestOwnerPaymentProducts,
  requestOwnerPayments,
  type OwnerReadState,
} from "../api/owner-payments.browser";
import type { PaymentPage } from "./payment-contract";
import {
  serializePaymentsListRequest,
  type PaymentsListRequest,
} from "./payment-filters";

/** Корень ключей платежей владельца: сверка сбрасывает его на всех открытых поверхностях вкладки. */
export const ownerPaymentsKey = ["owner-payments"] as const;

export function ownerPaymentsQueryOptions(request: PaymentsListRequest) {
  return queryOptions({
    queryKey: [
      ...ownerPaymentsKey,
      "list",
      serializePaymentsListRequest(request),
    ] as const,
    queryFn: ({ signal }) => requestOwnerPayments(request, signal),
  });
}

export function ownerPaymentProductsQueryOptions() {
  return queryOptions({
    queryKey: [...ownerPaymentsKey, "products"] as const,
    queryFn: ({ signal }) => requestOwnerPaymentProducts(signal),
  });
}

export function ownerPaymentQueryKey(purchaseRef: string) {
  return [...ownerPaymentsKey, "payment", purchaseRef.toLowerCase()] as const;
}

/**
 * Платёж с журналом операций по страницам: первая страница несёт сам платёж, следующие только
 * продолжают журнал. Продолжение читается кнопкой, а не целиком при открытии.
 */
export function ownerPaymentQueryOptions(purchaseRef: string) {
  return infiniteQueryOptions({
    queryKey: ownerPaymentQueryKey(purchaseRef),
    queryFn: async ({ pageParam, signal }) => {
      const page = await requestOwnerPayment(purchaseRef, pageParam, signal);
      // Неудачное продолжение остаётся ошибкой запроса: прочитанные страницы сохраняются, а
      // повтор берёт ту же позицию журнала.
      if (pageParam !== null && page.kind !== "ready")
        throw new Error(`Payment audit continuation failed: ${page.kind}`);
      return page;
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last: OwnerReadState<PaymentPage>) =>
      last.kind === "ready" ? last.value.nextAuditAfter : null,
  });
}
