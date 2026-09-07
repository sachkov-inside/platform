import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeLoading } from "@/_pages/home";

import { getHome, PersonalHome } from "@/_pages/home.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

export const metadata: Metadata = {
  title: "Главная",
};

export default function HomeRoute() {
  return <Suspense fallback={<HomeLoading />}><HomeContent /></Suspense>;
}

async function HomeContent() {
  const accessToken = await getOptionalPlatformAccessToken();
  return <PersonalHome result={await getHome(accessToken)} accessToken={accessToken} />;
}
