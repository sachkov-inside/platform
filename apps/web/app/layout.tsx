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
