import type { ReactNode } from "react";
import { Suspense } from "react";

import { currentLegalEdition } from "@inside/legal";

import { AppShell, QueryProvider } from "@/_app";
import { StorageNotice } from "@/features/storage-notice";
import { legalDocumentPath } from "@/shared/routing/public-page-path";
import { AuthenticationFeedback } from "@/widgets/auth-control";
import type { Viewport } from "next";

/**
 * Оболочка читает адрес через `usePathname()` в клиентском адаптере, поэтому у маршрута с параметром
 * нет предсобранной оболочки и прямой заход блокируется здесь, как и раньше. Переходы между
 * страницами внутри раскладки её не перерисовывают и проверяются на мгновенность (ADR 0026).
 */
export const instant = false;

export const viewport: Viewport = { themeColor: "#ffffff", colorScheme: "light" };

export default function PublicLayout({ children }: { readonly children: ReactNode }) {
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
