import { handleCurrentBilling } from "@/features/billing-subscription.server";
export function GET(): Promise<Response> {
  return handleCurrentBilling();
}
