import type { Metadata } from "next";

import { getHome, HomePage } from "@/_pages/home.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { publicPageMetadata, siteLinkPreview } from "@/shared/link-preview";
import { readPublicSiteOrigin } from "@/shared/link-preview/index.server";

export async function generateMetadata(): Promise<Metadata> {
  return publicPageMetadata(await readPublicSiteOrigin(), "website", siteLinkPreview());
}

/** Закреп читается до первого экрана, без скелета всей главной (#562); лента грузится внутри `HomePage`. */
export default async function HomeRoute() {
  const accessToken = await getOptionalPlatformAccessToken();
  return <HomePage result={await getHome(accessToken)} />;
}
