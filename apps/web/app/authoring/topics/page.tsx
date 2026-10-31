import type { Metadata } from "next";

import { requireAuthoringEntry } from "@/_app/authoring-entry.server";
import { ContentCollectionsPage } from "@/_pages/content-collections.server";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = { title: "Темы · Authoring" };

export default async function Page() {
  await requireAuthoringEntry();
  return <ContentCollectionsPage kind="topic" />;
}
