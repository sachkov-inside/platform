import type { ReactNode } from "react";
import { Suspense } from "react";

import { currentLegalEdition } from "@inside/legal";

import { AppShell, QueryProvider } from "@/_app";
import { StorageNotice } from "@/features/storage-notice";
import { legalDocumentPath } from "@/shared/routing/public-page-path";
import { AuthenticationFeedback } from "@/widgets/auth-control";
import type { Viewport } from "next";

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
