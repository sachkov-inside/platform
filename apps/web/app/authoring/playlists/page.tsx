import type { Metadata } from "next";

import { ContentCollectionsPage } from "@/_pages/content-collections.server";

export const metadata: Metadata = { title: "Практикумы" };

export default function Page() {
  return <ContentCollectionsPage kind="series" />;
}
