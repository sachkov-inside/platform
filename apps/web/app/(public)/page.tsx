import type { Metadata } from "next";

import { getHome, PersonalHome } from "@/_pages/home.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

export const metadata: Metadata = {
  title: "Главная",
};

export default async function HomeRoute() {
  const accessToken = await getOptionalPlatformAccessToken();
  return <PersonalHome result={await getHome(accessToken)} accessToken={accessToken} />;
}
