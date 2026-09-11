import { handleBillingPurchase } from "@/features/billing-checkout.server";
export function POST(request: Request): Promise<Response> {
  return handleBillingPurchase(request);
}
