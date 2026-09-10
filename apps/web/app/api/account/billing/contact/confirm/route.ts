import { handleConfirmBillingContact } from "@/features/billing-contact.server";
export function POST(request: Request): Promise<Response> {
  return handleConfirmBillingContact(request);
}
