import type { ReactNode } from "react";

import { QueryProvider } from "@/_app";
import { AuthoringShell } from "@/widgets/authoring-shell";

export default function AuthoringLayout({ children }: { readonly children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthoringShell>{children}</AuthoringShell>
    </QueryProvider>
  );
}
