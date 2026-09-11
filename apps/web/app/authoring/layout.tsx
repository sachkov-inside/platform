import type { Metadata } from "next";
import type { ReactNode } from "react";

import { QueryProvider } from "@/_app";
import { AuthoringShell } from "@/widgets/authoring-shell";

/** Авторская часть закрыта от индексации целиком, включая будущие разделы. */
export const metadata: Metadata = { robots: { follow: false, index: false } };

export default function AuthoringLayout({ children }: { readonly children: ReactNode }) {
  return (
    <QueryProvider>
      <AuthoringShell>{children}</AuthoringShell>
    </QueryProvider>
  );
}
