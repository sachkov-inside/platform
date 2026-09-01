import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Главная · Inside",
    template: "%s · Inside",
  },
  description: "Материалы, темы и серии Sachkov Inside",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
