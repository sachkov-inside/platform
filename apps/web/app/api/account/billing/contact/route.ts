import { handleReadBillingContact } from "@/features/billing-contact.server";
export function GET(): Promise<Response> {
  return handleReadBillingContact();
}
