import { handleBillingQuote } from "@/features/billing-checkout.server";
export function POST(request: Request): Promise<Response> {
  return handleBillingQuote(request);
}
