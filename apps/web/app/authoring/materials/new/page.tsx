import type { Metadata } from "next";

import { MaterialAuthoringPage } from "@/_pages/material-authoring.server";
import { parseAuthoringReturnHref } from "@/shared/routing/authoring";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0026). */
export const instant = false;

export const metadata: Metadata = {
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
