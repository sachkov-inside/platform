import {
  billingCommandPayload,
  billingCommandResult,
  changeQuoteSchema,
  changeResultSchema,
  currentBillingSchema,
  readBillingEndpoint,
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

export function readCurrentBilling(): Promise<
  BillingCommandResult<CurrentBilling>
> {
  return readBillingEndpoint("/api/account/billing", currentBillingSchema);
}

export async function cancelBillingRenewal(
  input: RevisionCommand,
): Promise<BillingCommandResult<SubscriptionView>> {
  return billingCommandResult(
    await requestSameOriginMutation(
      "/api/account/billing/subscription/cancel",
      "POST",
      billingCommandPayload(input),
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
      billingCommandPayload(input),
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
      billingCommandPayload(input),
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
      billingCommandPayload(input),
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
      billingCommandPayload(input),
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
      billingCommandPayload(input),
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
      billingCommandPayload(input),
    ),
    subscriptionViewSchema,
  );
}
