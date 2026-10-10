import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/_app/ui/fonts";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Главная · Sachkov Inside",
    template: "%s · Sachkov Inside",
  },
  description: "Материалы, темы и продукты Sachkov Inside",
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
