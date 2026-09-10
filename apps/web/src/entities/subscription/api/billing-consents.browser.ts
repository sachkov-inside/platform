import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  consentsValueSchema,
  type ConsentsInput,
} from "../model/legal-documents";
import {
  billingCommandPayload,
  billingCommandResult,
  type BillingCommandResult,
} from "./billing-result.browser";

/**
 * Одна команда согласия обслуживает и первую покупку, и возобновление списаний: контекст
 * различает их, а редакции документов приходят с сервера.
 */
export async function acceptBillingConsents(
  input: ConsentsInput,
): Promise<BillingCommandResult<{ readonly evidenceRefs: readonly string[] }>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/consents",
      "POST",
      billingCommandPayload(input),
    ),
    consentsValueSchema,
  );
}
