import type { Metadata } from "next";

import { ContentCollectionsPage } from "@/_pages/content-collections.server";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = { title: "Темы · Authoring" };

export default function Page() {
  return <ContentCollectionsPage kind="topic" />;
}
