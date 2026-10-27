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
      if (!result.ok) {
        // The registry sends a normalized query and its own limit: refusing them is a defect,
        // which the registry records and answers as an unavailable group.
        if (result.error.code === "invalid_request")
          throw new Error("Billing refused the payments search request");
        return { ok: false, error: result.error };
      }
      return {
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
      };
    },
  };
}
