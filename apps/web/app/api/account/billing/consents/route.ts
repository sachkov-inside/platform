import { handleBillingConsents } from "@/entities/subscription.server";
export function POST(request: Request): Promise<Response> {
  return handleBillingConsents(request);
}
