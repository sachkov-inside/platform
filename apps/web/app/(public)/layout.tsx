import type { ReactNode } from "react";

import { AppShell, QueryProvider } from "@/_app";

export default function PublicLayout({ children }: { readonly children: ReactNode }) {
  return (
    <QueryProvider>
      <AppShell>{children}</AppShell>
    </QueryProvider>
  );
}
