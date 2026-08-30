import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";

import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";

import {
  AppShell,
  AuthAccountSlot,
  AuthControlFallback,
  ProfileOnboardingSlot,
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
        <template
          data-direction-contract="member-profile-7cf2ca08"
          dangerouslySetInnerHTML={{
            __html:
              "<!-- THESIS: Private Account is an editable source beside its exact member projection, refusing a generic settings stack. OWN-WORLD: warm paper, charcoal type, fine workshop rules, scarce safety orange, rounded utility controls. STORY: the owner names themself, sees precisely what members see, then manages export or deletion without ambiguity. FIRST VIEWPORT: editor left, narrow labeled seam center, member projection right; the save action sits at the editor heading. FORM: Mirror seam, first of three dealt directions, seed 7cf2ca08. FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance -->",
          }}
        />
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
          <Suspense fallback={null}>
            <ProfileOnboardingSlot />
          </Suspense>
        </QueryProvider>
      </body>
    </html>
  );
}
