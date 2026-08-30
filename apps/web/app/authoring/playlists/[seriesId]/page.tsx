import type { Metadata } from "next";

import { SeriesOrderPage } from "@/_pages/series-order.server";

export const metadata: Metadata = { robots: { follow: false, index: false }, title: "Порядок плейлиста" };

export default async function Page({ params }: { readonly params: Promise<{ readonly seriesId: string }> }) {
  const { seriesId } = await params;
  return <SeriesOrderPage seriesId={seriesId} />;
}
