import type { ReactNode } from "react";

import { AppShell } from "@/_app";

export default function PublicLayout({ children }: { readonly children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
