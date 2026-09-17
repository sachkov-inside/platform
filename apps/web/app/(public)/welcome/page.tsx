import type { Metadata } from "next";

import { getHome, HomePage } from "@/_pages/home.server";
import { WelcomePage } from "@/_pages/welcome.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

export const metadata: Metadata = {
  title: "Добро пожаловать",
  robots: { follow: false, index: false },
};

export default async function WelcomeRoute({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly returnTo?: string | readonly string[] }>;
}) {
  const { returnTo } = await searchParams;
  return <WelcomePage backdrop={<WelcomeBackdrop />} returnTo={typeof returnTo === "string" ? returnTo : "/"} />;
}

/** Главная за окном: только закреплённый продукт, без ленты, которая меняла бы адрес страницы. */
async function WelcomeBackdrop() {
  const home = await getHome(await getOptionalPlatformAccessToken());
  return <HomePage feed={<div className="min-h-[60vh]" />} result={home} />;
}
