import { handleBillingOffers } from "@/features/billing-checkout.server";
export function GET(): Promise<Response> {
  return handleBillingOffers();
}
