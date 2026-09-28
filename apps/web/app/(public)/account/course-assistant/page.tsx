import type { Metadata } from "next";

import { AccountCourseAssistantPage } from "@/_pages/account-course-assistant";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = {
  title: "Помощник курса",
};

export default async function AccountCourseAssistantRoute({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly connection?: string | string[] }>;
}) {
  const { connection } = await searchParams;
  return (
    <AccountCourseAssistantPage
      connection={typeof connection === "string" ? connection : undefined}
    />
  );
}
