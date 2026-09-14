import type { Metadata } from "next";
import { Suspense } from "react";
import { HomeLoading } from "@/_pages/home";

import { getHome, HomePage } from "@/_pages/home.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { publicPageMetadata, siteLinkPreview } from "@/shared/link-preview";
import { readPublicSiteOrigin } from "@/shared/link-preview/index.server";

export async function generateMetadata(): Promise<Metadata> {
  return publicPageMetadata(await readPublicSiteOrigin(), "website", siteLinkPreview());
}

export default function HomeRoute() {
  return <Suspense fallback={<HomeLoading />}><HomeContent /></Suspense>;
}

async function HomeContent() {
  const accessToken = await getOptionalPlatformAccessToken();
  return <HomePage result={await getHome(accessToken)} />;
}
