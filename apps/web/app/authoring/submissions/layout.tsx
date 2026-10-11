import type { ReactNode } from "react";

import { TaskSubmissionsRuntime } from "@/_pages/task-submissions";

export default function SubmissionsLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <TaskSubmissionsRuntime>{children}</TaskSubmissionsRuntime>;
}
