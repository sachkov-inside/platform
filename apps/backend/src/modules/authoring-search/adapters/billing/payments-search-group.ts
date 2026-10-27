import type { BillingPaymentSearch } from "../../../billing/index.js";
import type { AuthoringSearchGroup } from "../../ports/authoring-search-group.js";

/** The Payments group; Billing decides `billing:manage`. */
export function assemblePaymentsSearchGroup(
  payments: Pick<BillingPaymentSearch, "search">,
): AuthoringSearchGroup {
  return {
    kind: "payments",
    search: async (request) => {
      const result = await payments.search(request);
      return result.ok
        ? {
            ok: true,
            value: {
              kind: "payments",
              state: "ready",
              items: result.value.map((payment) => ({
                purchaseRef: payment.purchaseRef,
                productName: payment.productName,
                amountKopecks: payment.amountKopecks,
                state: payment.state,
                createdAt: payment.createdAt,
              })),
            },
          }
        : result;
    },
  };
}
