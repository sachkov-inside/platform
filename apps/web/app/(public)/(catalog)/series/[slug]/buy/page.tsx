import type { Metadata } from "next";

import { GuidePurchasePage } from "@/_pages/guide-purchase.server";
import { loadPublishedSeries } from "@/features/library-discovery.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

interface GuidePurchaseRouteProps {
  readonly params: Promise<{ readonly slug: string }>;
}

export async function generateMetadata({
  params,
}: GuidePurchaseRouteProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadPublishedSeries(
    slug,
    await getOptionalPlatformAccessToken(),
  );
  const name =
    result.kind === "ready" || result.kind === "empty"
      ? result.reference.name
      : undefined;
  return {
    title: name === undefined ? "Покупка руководства" : `Купить «${name}»`,
    robots: { follow: true, index: false },
  };
}

export default async function GuidePurchaseRoute({
  params,
}: GuidePurchaseRouteProps) {
  const { slug } = await params;
  const accessToken = await getOptionalPlatformAccessToken();
  return (
    <GuidePurchasePage
      {...(accessToken === undefined ? {} : { accessToken })}
      slug={slug}
    />
  );
}
