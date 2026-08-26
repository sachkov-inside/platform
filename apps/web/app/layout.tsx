import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";

import {
  AppShell,
  AuthAccountSlot,
  AuthControlFallback,
  QueryProvider,
} from "@/_app";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Главная · Inside",
    template: "%s · Inside",
  },
  description: "Материалы, темы и серии Sachkov Inside",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <QueryProvider>
          <AppShell
            desktopAccountSlot={
              <Suspense fallback={<AuthControlFallback presentation="desktop" />}>
                <AuthAccountSlot presentation="desktop" />
              </Suspense>
            }
            mobileAccountSlot={
              <Suspense fallback={<AuthControlFallback presentation="mobile" />}>
                <AuthAccountSlot presentation="mobile" />
              </Suspense>
            }
          >
            {children}
          </AppShell>
        </QueryProvider>
      </body>
    </html>
  );
}
