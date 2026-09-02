import type { Metadata } from "next";

import { ContentCollectionsPage } from "@/_pages/content-collections.server";

export const metadata: Metadata = { robots: { follow: false, index: false }, title: "Плейлисты" };

export default function Page() {
  return <ContentCollectionsPage kind="series" />;
}
