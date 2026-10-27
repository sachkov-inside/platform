import { reportDependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  PAYMENT_SEARCH_ACCOUNT_LIMIT,
  type BillingPaymentSearch,
} from "../../../billing/index.js";
import type { PeopleDirectory } from "../../../people-directory/index.js";
import type {
  AuthoringSearchGroup,
  PaymentPersonSearchState,
} from "../../ports/authoring-search-group.js";

/**
 * The Payments group: by order number, bank payment number, exact amount or person. The people
 * directory finds the people the text names and Billing their payments; both require
 * `billing:manage`, and the people directory refuses first, before it reads anyone. A hit names
 * the payment only, never the person.
 *
 * The search by person is an extra channel: when the people directory fails, the failure is
 * recorded, payments are still searched by their own facts, and `personSearch` says what was not
 * searched.
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
      let accountIds: readonly string[] = [];
      let personSearch: PaymentPersonSearchState = "available";
      if (found.ok) {
        accountIds = found.value.accountIds;
        if (found.value.nameSearch === "unavailable")
          personSearch = "name_unavailable";
        else if (found.value.nameSearch === "truncated")
          personSearch = "truncated";
      } else if (found.error.code === "forbidden") {
        return { ok: false, error: found.error };
      } else if (found.error.code === "dependency_unavailable") {
        // Only the code is recorded: the query may be an email address.
        reportDependencyFailure(
          { module: "authoring-search", operation: "searchAuthoring" },
          found.error,
        );
        personSearch = "unavailable";
      }
      // `invalid_request`: a text the directory does not read as a person term finds no person.
      const result = await payments.search({ ...request, accountIds });
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
          personSearch,
        },
      };
    },
  };
}
