"use client";

import type { ReactNode } from "react";

import { useAwaitingFeedbackCount } from "@/features/submission-feedback-queue";
import { AuthoringShell } from "@/widgets/authoring-shell";

/**
 * Продакшен-адаптер каркаса админки: подставляет в `AuthoringShell` счётчик сдач без
 * комментария из чтения браузера. Storybook передаёт каркасу число сам.
 */
export function AuthoringApplicationShell({
  children,
}: {
  readonly children: ReactNode;
}) {
  const awaitingFeedbackCount = useAwaitingFeedbackCount();
  return (
    <AuthoringShell awaitingFeedbackCount={awaitingFeedbackCount}>
      {children}
    </AuthoringShell>
  );
}
