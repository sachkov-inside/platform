import type { ReactNode } from "react";
import { Suspense } from "react";

import { currentLegalEdition } from "@inside/legal";

import { StorageNotice } from "@/features/storage-notice";
import { legalDocumentPath } from "@/shared/routing/public-page-path";
import { AuthenticationFeedback } from "@/widgets/auth-control";
import { AppShell } from "./app-shell";
import { QueryProvider } from "./query-provider.client";

/**
 * Публичная оболочка целиком: шапка, навигация, сообщения о входе и уведомление о хранении.
 * Её надевают публичная раскладка и корневая страница «не найдено», которая стоит вне раскладки.
 */
export function PublicShell({ children }: { readonly children: ReactNode }) {
  return (
    <QueryProvider>
      <AppShell>
        <Suspense fallback={null}>
          <AuthenticationFeedback />
        </Suspense>
        {children}
        <StorageNotice
          edition={currentLegalEdition("cookies").version}
          policyHref={legalDocumentPath("cookies")}
        />
      </AppShell>
    </QueryProvider>
  );
}
