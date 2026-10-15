import "server-only";
import { notFound } from "next/navigation";
import { paymentLinkDetailSchema } from "@/entities/subscription";
import {
  requestBillingPaymentLink,
  resolveAccount,
} from "@/shared/api/backend/index.server";
import { ProductPurchase } from "./product-purchase.client";

export async function IndividualPurchasePage({
  id,
  accessToken,
}: {
  readonly id: string;
  readonly accessToken?: string;
}) {
  const [response, account] = await Promise.all([
    requestBillingPaymentLink(id),
    accessToken === undefined
      ? Promise.resolve(null)
      : resolveAccount(accessToken),
  ]);
  if (!response.ok) {
    if (response.response.status === 404) notFound();
    throw new Error("Payment link unavailable");
  }
  const parsed = paymentLinkDetailSchema.safeParse(response.body);
  if (!parsed.success) throw new Error("Invalid payment link response");
  const link = parsed.data;
  return (
    <ProductPurchase
      key={id}
      individualLink={link}
      product={
        link.product === null
          ? null
          : { id: link.product.id, name: link.product.title }
      }
      offers={[link.snapshot]}
      slug={link.product?.slug ?? ""}
      signedIn={accessToken !== undefined}
      accountId={account?.accountId ?? null}
    />
  );
}
