import { ShieldAlert } from "lucide-react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { RetryPageButton } from "@/shared/ui/retry-page-button.client";
import { StatusPanel } from "@/shared/ui/status-panel";

import { loadCourseGlossary } from "../api/load-course-glossary.server";
import {
  CourseGlossaryLoading,
  CourseGlossaryView,
} from "./course-glossary-view";

/**
 * «Словарь курса» (#2127). Состав зависит от читателя: урок, который ему закрыт, не показывает
 * своих терминов. Поэтому вся страница — личная часть под скелетом (ADR 0027).
 */
export async function CourseGlossaryPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string }>;
}) {
  const { slug } = await params;
  return (
    <Suspense fallback={<CourseGlossaryLoading />}>
      <PersonalCourseGlossary slug={slug} />
    </Suspense>
  );
}

async function PersonalCourseGlossary({ slug }: { readonly slug: string }) {
  // `connection()` останавливает предзагрузку до чтения сессии.
  await connection();
  const accessToken = await getOptionalPlatformAccessToken();
  const result = await loadCourseGlossary(slug, accessToken);
  if (result.kind === "not-found") notFound();
  if (result.kind === "unavailable")
    return (
      <StatusPanel
        action={<RetryPageButton />}
        icon={<ShieldAlert aria-hidden="true" />}
        message="Словарь не отвечает. Попробуйте ещё раз через несколько минут."
        state={{ "data-course-glossary-state": "unavailable" }}
        title="Словарь временно недоступен"
      />
    );
  return <CourseGlossaryView glossary={result} />;
}
