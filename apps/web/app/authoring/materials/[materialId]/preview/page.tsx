import type { Metadata } from "next";

import { MaterialCurrentPreviewPage } from "@/_pages/material-authoring.server";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Preview черновика",
};

export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly materialId: string }>;
}) {
  const { materialId } = await params;
  return <MaterialCurrentPreviewPage materialId={materialId} />;
}
