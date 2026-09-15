import type { Metadata } from "next";

import { WelcomePage } from "@/_pages/welcome.server";

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
  return <WelcomePage returnTo={typeof returnTo === "string" ? returnTo : "/"} />;
}
