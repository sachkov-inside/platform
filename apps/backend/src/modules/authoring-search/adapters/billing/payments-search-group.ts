import {
  PAYMENT_SEARCH_ACCOUNT_LIMIT,
  type BillingPaymentSearch,
} from "../../../billing/index.js";
import type { PeopleDirectory } from "../../../people-directory/index.js";
import type { AuthoringSearchGroup } from "../../ports/authoring-search-group.js";

/**
 * The Payments group: by order number, bank payment number, exact amount or person. The people
 * directory finds the people the text names and Billing their payments; both require
 * `billing:manage`, and the people directory refuses first, before it reads anyone. A hit names
 * the payment only, never the person.
 */
export function assemblePaymentsSearchGroup(
  payments: Pick<BillingPaymentSearch, "search">,
  people: Pick<PeopleDirectory, "searchPersonAccounts">,
): AuthoringSearchGroup {
  return {
    kind: "payments",
    search: async (request) => {
      const found = await people.searchPersonAccounts(request.actor, {
        query: request.query,
        limit: PAYMENT_SEARCH_ACCOUNT_LIMIT,
      });
      // A text the directory does not read as a person term finds no person, only payments.
      if (!found.ok) {
        if (found.error.code === "forbidden")
          return { ok: false, error: found.error };
        if (found.error.code === "dependency_unavailable")
          return {
            ok: false,
            error: { code: "dependency_unavailable", retryable: true },
          };
      }
      const result = await payments.search({
        ...request,
        accountIds: found.ok ? found.value : [],
      });
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
