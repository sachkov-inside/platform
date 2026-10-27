import { handleCreatePaymentLink } from "@/features/payment-links.server";

export function POST(request: Request): Promise<Response> {
  return handleCreatePaymentLink(request);
}
