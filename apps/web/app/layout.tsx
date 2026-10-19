import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@/_app/ui/fonts";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Главная · Sachkov Dev",
    template: "%s · Sachkov Dev",
  },
  description: "Материалы, темы и продукты Sachkov Dev",
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
