import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/_app/ui/fonts";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Главная · sachkov.dev",
    template: "%s · sachkov.dev",
  },
  description: "Материалы, темы и продукты sachkov.dev",
  // Android и ChromeOS увеличивают текст по системной настройке размера шрифта: размеры в `rem`.
  other: { "text-scale": "scale" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    // The lesson-menu restore script marks <html> before hydration (#2158).
    <html lang="ru" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
