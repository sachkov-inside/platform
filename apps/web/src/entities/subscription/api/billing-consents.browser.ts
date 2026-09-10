import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  consentsValueSchema,
  type ConsentsInput,
} from "../model/legal-documents";
import {
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
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/consents",
      "POST",
      form,
    ),
    consentsValueSchema,
  );
}
