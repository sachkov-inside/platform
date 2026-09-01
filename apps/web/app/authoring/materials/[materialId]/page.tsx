import type { Metadata } from "next";

import { CurrentMaterialAuthoringPage } from "@/_pages/material-authoring.server";
import { parseAuthoringReturnHref } from "@/shared/routing/authoring";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Редактор Material",
};

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly materialId: string }>;
  readonly searchParams: Promise<{ readonly from?: string | readonly string[] }>;
}) {
  const [{ materialId }, query] = await Promise.all([params, searchParams]);
  return (
    <CurrentMaterialAuthoringPage
      materialId={materialId}
      returnHref={parseAuthoringReturnHref(query.from)}
    />
  );
}
