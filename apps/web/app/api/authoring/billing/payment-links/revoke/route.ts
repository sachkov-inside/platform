import { handleRevokePaymentLink } from "@/features/billing-admin.server";
export function POST(request: Request): Promise<Response> {
  return handleRevokePaymentLink(request);
}
