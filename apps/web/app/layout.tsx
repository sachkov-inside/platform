import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/_app/ui/fonts";
import { ThemeRestore } from "@/features/theme-preference";

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
    // The theme and lesson-menu restore scripts mark <html> before hydration (#2158).
    <html lang="ru" suppressHydrationWarning>
      <head>
        <ThemeRestore />
      </head>
      <body>{children}</body>
    </html>
  );
}
