import type { Metadata } from "next";

import { CurrentMaterialAuthoringPage } from "@/_pages/material-authoring.server";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Редактор Material",
};

export default async function Page({
  params,
}: {
  readonly params: Promise<{ readonly materialId: string }>;
}) {
  const { materialId } = await params;
  return <CurrentMaterialAuthoringPage materialId={materialId} />;
}
