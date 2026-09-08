import { handleStartBillingContact } from "@/_pages/billing-contact.server";
export function POST(request: Request): Promise<Response> {
  return handleStartBillingContact(request);
}
