import { handleListPaymentLinks } from "@/features/payment-links.server";

export function POST(request: Request): Promise<Response> {
  return handleListPaymentLinks(request);
}
