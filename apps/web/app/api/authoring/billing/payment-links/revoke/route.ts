import { handleRevokePaymentLink } from "@/features/payment-links.server";

export function POST(request: Request): Promise<Response> {
  return handleRevokePaymentLink(request);
}
