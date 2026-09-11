import { handleCancelRenewal } from "@/features/billing-subscription.server";
export function POST(request: Request): Promise<Response> {
  return handleCancelRenewal(request);
}
