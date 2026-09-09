import type { Metadata } from "next";

import { SeriesEditorPage } from "@/_pages/content-collections.server";

export const metadata: Metadata = { robots: { follow: false, index: false }, title: "Редактирование руководства" };

export default async function Page({ params }: { readonly params: Promise<{ readonly seriesId: string }> }) {
  const { seriesId } = await params;
  return <SeriesEditorPage seriesId={seriesId} />;
}
