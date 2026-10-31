import type { Metadata } from "next";

import { requireAuthoringEntry } from "@/_app/authoring-entry.server";
import { TaskSubmissionsPage } from "@/_pages/task-submissions.server";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = { title: "Сдачи · Authoring" };

export default async function TaskSubmissionsRoute({
  searchParams,
}: {
  readonly searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}) {
  await requireAuthoringEntry();
  return <TaskSubmissionsPage searchParams={searchParams} />;
}
