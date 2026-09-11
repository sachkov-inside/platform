import { handleBillingPurchaseStatus } from "@/features/billing-checkout.server";
export function GET(request: Request): Promise<Response> {
  return handleBillingPurchaseStatus(request);
}
