import type { Metadata } from "next";

import { TaskSubmissionsPage } from "@/_pages/task-submissions.server";

export const metadata: Metadata = { title: "Сдачи · Authoring" };

export default function TaskSubmissionsRoute({
  searchParams,
}: {
  readonly searchParams: Promise<
    Readonly<Record<string, string | string[] | undefined>>
  >;
}) {
  return <TaskSubmissionsPage searchParams={searchParams} />;
}
