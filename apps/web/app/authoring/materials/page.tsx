import type { Metadata } from "next";

import { requireAuthoringEntry } from "@/_app/authoring-entry.server";
import { AuthoringMaterialsPage } from "@/_pages/authoring-materials.server";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = {
  title: "Материалы · Authoring",
};

export default async function Page() {
  await requireAuthoringEntry();
  return <AuthoringMaterialsPage />;
}
