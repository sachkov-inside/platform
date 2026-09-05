import type { ReactNode } from "react";
import { Suspense } from "react";

import { AppShell, QueryProvider } from "@/_app";
import { AuthenticationFeedback } from "@/widgets/auth-control";

export default function PublicLayout({ children }: { readonly children: ReactNode }) {
  return (
    <QueryProvider>
      <AppShell>
        <Suspense fallback={null}>
          <AuthenticationFeedback />
        </Suspense>
        {children}
      </AppShell>
    </QueryProvider>
  );
}
