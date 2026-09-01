import type { Metadata } from "next";

import { MemberProfilePage } from "@/_pages/member-profile.server";

export const metadata: Metadata = {
  title: "Профиль участника",
  robots: { follow: false, index: false },
};

interface MemberProfileRouteProps {
  readonly params: Promise<{ readonly publicProfileId: string }>;
}

export default async function MemberProfileRoute({
  params,
}: MemberProfileRouteProps) {
  const { publicProfileId } = await params;
  return <MemberProfilePage publicProfileId={publicProfileId} />;
}
