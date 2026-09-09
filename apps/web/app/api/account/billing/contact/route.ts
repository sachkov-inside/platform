import { handleReadBillingContact } from "@/_pages/billing-contact.server";
export function GET(): Promise<Response> {
  return handleReadBillingContact();
}
