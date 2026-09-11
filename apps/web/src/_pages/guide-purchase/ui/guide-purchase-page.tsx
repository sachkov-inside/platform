import { notFound } from "next/navigation";

import { loadGuideOffers } from "@/entities/subscription.server";
import { loadPublishedSeries } from "@/features/library-discovery.server";

import { GuidePurchase } from "./guide-purchase.client";

/**
 * Витрина одного руководства: его название и цена приходят с сервера, а оформление идёт тем
 * же путём расчёта, согласий и оплаты, что и подписка.
 */
export async function GuidePurchasePage({
  accessToken,
  slug,
}: {
  readonly accessToken?: string;
  readonly slug: string;
}) {
  const guide = await loadPublishedSeries(slug, accessToken);
  if (guide.kind === "not-found") notFound();
  if (guide.kind === "unavailable" || guide.reference.id === undefined) {
    return <GuidePurchase guide={null} offers={[]} slug={slug} unavailable />;
  }
  const catalog = await loadGuideOffers(guide.reference.id);
  return (
    <GuidePurchase
      guide={{ name: guide.reference.name, summary: guide.reference.summary }}
      offers={catalog.kind === "ready" ? catalog.offers : []}
      slug={slug}
      unavailable={catalog.kind === "unavailable"}
    />
  );
}
