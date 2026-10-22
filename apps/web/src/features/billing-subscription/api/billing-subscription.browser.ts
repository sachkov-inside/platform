import {
  cancelBillingRenewalOperation,
  resumeBillingRenewalOperation,
  quoteBillingChangeOperation,
  changeBillingOptionOperation,
  cancelBillingChangeOperation,
  changeBillingPaymentMethodOperation,
  revokeBillingPaymentMethodOperation,
} from "./billing-subscription.operation";
import {
  currentBillingSchema,
  readBillingEndpoint,
  type BillingCommandResult,
  type CurrentBilling,
} from "@/entities/subscription";

export function readCurrentBilling(): Promise<
  BillingCommandResult<CurrentBilling>
> {
  return readBillingEndpoint("/api/account/billing", currentBillingSchema);
}

export const cancelBillingRenewal = cancelBillingRenewalOperation.send;

export const resumeBillingRenewal = resumeBillingRenewalOperation.send;

export const quoteBillingChange = quoteBillingChangeOperation.send;

export const changeBillingOption = changeBillingOptionOperation.send;

export const cancelBillingChange = cancelBillingChangeOperation.send;

export const changeBillingPaymentMethod =
  changeBillingPaymentMethodOperation.send;

export const revokeBillingPaymentMethod =
  revokeBillingPaymentMethodOperation.send;
