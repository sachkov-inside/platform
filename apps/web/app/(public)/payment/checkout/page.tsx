import { connection } from "next/server";
import { PaymentCheckoutRedirect } from "@/_pages/subscription.server";

export const instant = false;
export default async function PaymentCheckoutRoute({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly offer?: string | readonly string[];
    readonly from?: string | readonly string[];
    readonly promo?: string | readonly string[];
  }>;
}) {
  await connection();
  return <PaymentCheckoutRedirect searchParams={await searchParams} />;
}
