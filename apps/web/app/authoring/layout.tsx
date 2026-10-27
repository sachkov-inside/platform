import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthoringApplicationShell, QueryProvider } from "@/_app";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

/** Авторская часть закрыта от индексации целиком, включая будущие разделы. */
export const metadata: Metadata = { robots: { follow: false, index: false } };

export default function AuthoringLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <QueryProvider>
      <AuthoringApplicationShell>{children}</AuthoringApplicationShell>
    </QueryProvider>
  );
}
