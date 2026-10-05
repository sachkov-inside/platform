import type { ReactNode } from "react";
import { Suspense } from "react";

import { currentLegalEdition } from "@inside/legal";

import { StorageNotice } from "@/features/storage-notice";
import { legalDocumentPath } from "@/shared/routing/public-page-path";
import { AuthenticationFeedback } from "@/widgets/auth-control";

/**
 * Содержимое публичной оболочки вокруг страницы: сообщение о входе до неё и уведомление о
 * хранении после. Его ставят `PublicShell` и окружение Storybook, поэтому страница в каталоге
 * окружена тем же составом.
 */
export function PublicShellContent({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <AuthenticationFeedback />
      </Suspense>
      {children}
      <StorageNotice
        edition={currentLegalEdition("cookies").version}
        policyHref={legalDocumentPath("cookies")}
      />
    </>
  );
}
