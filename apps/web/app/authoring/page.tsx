import type { Metadata } from "next";

import { requireAuthoringEntry } from "@/_app/authoring-entry.server";
import { AuthoringOverviewPage } from "@/_pages/authoring-overview.server";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = { title: "Обзор · Authoring" };

export default async function Page() {
  await requireAuthoringEntry();
  return <AuthoringOverviewPage />;
}
