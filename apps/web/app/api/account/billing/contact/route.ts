import { connection } from "next/server";

import { handleReadBillingContact } from "@/features/billing-contact.server";
export async function GET(): Promise<Response> {
  await connection();
  return handleReadBillingContact();
}
