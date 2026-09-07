import type { Metadata } from "next";

import { getHome, PersonalHome } from "@/_pages/home.server";
import { PublicRouteTransition } from "@/_app";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";

export const metadata: Metadata = {
  title: "Главная",
};

export default async function HomeRoute() {
  const accessToken = await getOptionalPlatformAccessToken();
  return <PublicRouteTransition><PersonalHome result={await getHome(accessToken)} accessToken={accessToken} /></PublicRouteTransition>;
}
