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
