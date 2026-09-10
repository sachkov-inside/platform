import {
  billingCommandResult,
  billingReadResult,
  changeQuoteSchema,
  changeResultSchema,
  currentBillingSchema,
  subscriptionViewSchema,
  type BillingCommandResult,
  type ChangeQuote,
  type ChangeResult,
  type CurrentBilling,
  type SubscriptionView,
} from "@/entities/subscription";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  methodChangeValueSchema,
  type ChangeInput,
  type ChangeQuoteInput,
  type MethodChange,
  type ResumeInput,
  type RevisionCommand,
  type RevokeMethodInput,
} from "../model/subscription-commands";

function payload(input: unknown): FormData {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  return form;
}

export async function readCurrentBilling(): Promise<
  BillingCommandResult<CurrentBilling>
> {
  try {
    const response = await fetch("/api/account/billing", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    return await billingReadResult(response, currentBillingSchema);
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export async function cancelBillingRenewal(
  input: RevisionCommand,
): Promise<BillingCommandResult<SubscriptionView>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/subscription/cancel",
      "POST",
      payload(input),
    ),
    subscriptionViewSchema,
  );
}

export async function resumeBillingRenewal(
  input: ResumeInput,
): Promise<BillingCommandResult<SubscriptionView>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/subscription/resume",
      "POST",
      payload(input),
    ),
    subscriptionViewSchema,
  );
}

export async function quoteBillingChange(
  input: ChangeQuoteInput,
): Promise<BillingCommandResult<ChangeQuote>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/subscription/change-quote",
      "POST",
      payload(input),
    ),
    changeQuoteSchema,
  );
}

export async function changeBillingOption(
  input: ChangeInput,
): Promise<BillingCommandResult<ChangeResult>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/subscription/change",
      "POST",
      payload(input),
    ),
    changeResultSchema,
  );
}

export async function cancelBillingChange(
  input: RevisionCommand,
): Promise<BillingCommandResult<SubscriptionView>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/subscription/change-cancel",
      "POST",
      payload(input),
    ),
    subscriptionViewSchema,
  );
}

export async function changeBillingPaymentMethod(
  input: RevisionCommand,
): Promise<BillingCommandResult<MethodChange>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/payment-method/change",
      "POST",
      payload(input),
    ),
    methodChangeValueSchema,
  );
}

export async function revokeBillingPaymentMethod(
  input: RevokeMethodInput,
): Promise<BillingCommandResult<SubscriptionView>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/payment-method/revoke",
      "POST",
      payload(input),
    ),
    subscriptionViewSchema,
  );
}
