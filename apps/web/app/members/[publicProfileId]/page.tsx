import type { Metadata } from "next";

import { MemberProfilePage } from "@/_pages/member-profile.server";

export const metadata: Metadata = {
  title: "Профиль участника",
  robots: { follow: false, index: false },
};

export default async function Page({
  params,
}: PageProps<"/members/[publicProfileId]">) {
  const { publicProfileId } = await params;
  return <MemberProfilePage publicProfileId={publicProfileId} />;
}
