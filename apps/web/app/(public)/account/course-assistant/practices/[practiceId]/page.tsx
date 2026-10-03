import type { Metadata } from "next";

import { AccountPracticeReviewPage } from "@/_pages/account-practice-review";

/** Беседа целиком зависит от сессии и на слои не разложена: проверка мгновенности с неё снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = {
  title: "Проверка задания",
};

export default async function AccountPracticeReviewRoute({
  params,
}: {
  readonly params: Promise<{ readonly practiceId: string }>;
}) {
  const { practiceId } = await params;
  return <AccountPracticeReviewPage practiceId={practiceId} />;
}
