import type { Metadata } from "next";
import type { ReactNode } from "react";

import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/manrope/wght.css";

import { DevelopmentFeedbackOverlay } from "@/_app/ui/development-feedback-overlay.client";
import { readWebRuntimeMode } from "@/shared/config/index.server";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Главная · Inside",
    template: "%s · Inside",
  },
  description: "Материалы, темы и плейлисты Sachkov Inside",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const showFeedbackOverlay = readWebRuntimeMode() === "development";

  return (
    <html lang="ru">
      <body>
        {children}
        {showFeedbackOverlay ? <DevelopmentFeedbackOverlay /> : null}
      </body>
    </html>
  );
}
