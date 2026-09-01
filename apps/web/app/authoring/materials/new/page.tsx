import type { Metadata } from "next";

import { MaterialAuthoringPage } from "@/_pages/material-authoring.server";
import { parseAuthoringReturnHref } from "@/shared/routing/authoring";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Новый материал",
};

export default async function Page({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly from?: string | readonly string[] }>;
}) {
  const query = await searchParams;
  return <MaterialAuthoringPage returnHref={parseAuthoringReturnHref(query.from)} />;
}
