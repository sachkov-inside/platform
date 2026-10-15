import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { IndividualPurchasePage } from "@/_pages/product-purchase.server";
import { redirectUntilTermsAccepted } from "@/features/terms-acceptance.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
export const instant = false;
export const metadata: Metadata = {
  title: "Покупка по ссылке",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function IndividualPurchaseRoute({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams: Promise<{
    readonly purchaseRef?: string | readonly string[];
  }>;
}) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const query = await searchParams;
  const ref = z.uuid().safeParse(query.purchaseRef);
  const returnTo = `/payment/links/${id}${ref.success ? `?purchaseRef=${ref.data}` : ""}`;
  await redirectUntilTermsAccepted(returnTo);
  const accessToken = await getOptionalPlatformAccessToken();
  return (
    <IndividualPurchasePage
      id={id}
      {...(accessToken === undefined ? {} : { accessToken })}
    />
  );
}
