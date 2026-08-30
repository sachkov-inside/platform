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
import {
  ProfileOnboardingSlot,
  resolveAccountProfileRuntime,
} from "@/_app/index.server";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Главная · Inside",
    template: "%s · Inside",
  },
  description: "Материалы, темы и серии Sachkov Inside",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const profileRuntime = await resolveAccountProfileRuntime();
  const profileGateRequired =
    profileRuntime.kind === "unavailable" ||
    (profileRuntime.kind === "authenticated" && profileRuntime.profile === null);

  return (
    <html lang="ru">
      <body>
        <QueryProvider>
          <div
            data-profile-gated={profileGateRequired || undefined}
            inert={profileGateRequired || undefined}
          >
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
          </div>
          <ProfileOnboardingSlot runtime={profileRuntime} />
        </QueryProvider>
      </body>
    </html>
  );
}
