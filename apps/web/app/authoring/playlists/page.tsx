import type { Metadata } from "next";

import { ContentCollectionsPage } from "@/_pages/content-collections.server";

export const metadata: Metadata = { title: "Руководства" };

export default function Page() {
  return <ContentCollectionsPage kind="series" />;
}
