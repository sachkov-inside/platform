import {
  defineMutationOperation,
  type MutationTransportFailure,
} from "@/shared/api/mutation-operation";

import {
  confirmContactInputSchema,
  confirmContactResultSchema,
  startContactInputSchema,
  startContactResultSchema,
  type ContactFailure,
} from "../model/billing-contact";

function contactTransportFailure(
  failure: MutationTransportFailure,
): ContactFailure {
  return {
    ok: false,
    code:
      failure.kind === "status" && failure.status === 401
        ? "unauthorized"
        : "unavailable",
  };
}

/** Starts confirmation of the Account's receipt email. */
export const startBillingContactOperation = defineMutationOperation({
  input: startContactInputSchema,
  method: "POST",
  path: "/api/account/billing/contact/start",
  result: startContactResultSchema,
  transportFailure: contactTransportFailure,
});

/** Confirms the receipt email with the code the Account received. */
export const confirmBillingContactOperation = defineMutationOperation({
  input: confirmContactInputSchema,
  method: "POST",
  path: "/api/account/billing/contact/confirm",
  result: confirmContactResultSchema,
  transportFailure: contactTransportFailure,
});
