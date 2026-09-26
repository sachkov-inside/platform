import type { Metadata } from "next";

import { getHome, HomePage } from "@/_pages/home.server";
import { WelcomePage } from "@/_pages/welcome.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

/** Раздел целиком зависит от сессии и на слои не разложен: проверка мгновенности с него снята (ADR 0027). */
export const instant = false;

export const metadata: Metadata = {
  title: "Добро пожаловать",
  robots: { follow: false, index: false },
};

export default async function WelcomeRoute({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly returnTo?: string | readonly string[];
  }>;
}) {
  const { returnTo } = await searchParams;
  return (
    <WelcomePage
      backdrop={<WelcomeBackdrop />}
      returnTo={typeof returnTo === "string" ? returnTo : "/"}
    />
  );
}

/**
 * Главная за окном: только закреплённый продукт, без ленты, которая меняла бы адрес страницы.
 * Это декорация: её сбой не должен мешать принять условия.
 */
async function WelcomeBackdrop() {
  const home = await getHome(await getOptionalPlatformAccessToken()).catch(
    () => undefined,
  );
  if (home === undefined) return null;
  return <HomePage feed={<div className="min-h-[60vh]" />} result={home} />;
}
