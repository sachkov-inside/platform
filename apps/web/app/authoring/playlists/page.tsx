import type { Metadata } from "next";

import { SeriesOrderIndexPage } from "@/_pages/series-order.server";

export const metadata: Metadata = { robots: { follow: false, index: false }, title: "Плейлисты" };

export default function Page() {
  return <SeriesOrderIndexPage />;
}
