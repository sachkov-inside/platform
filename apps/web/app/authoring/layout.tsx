import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AuthoringApplicationShell, QueryProvider } from "@/_app";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

/** Авторская часть закрыта от индексации целиком, включая будущие разделы. */
export const metadata: Metadata = { robots: { follow: false, index: false } };

/**
 * `viewportFit: "cover"` включает отступы `env(safe-area-inset-*)`: без него они на iPhone равны
 * нулю, и нижняя панель админки уходила бы под полосу «Домой».
 */
export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  viewportFit: "cover",
};

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
