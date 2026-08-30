import { notFound } from "next/navigation";

import { MemberProfileProjection } from "@/_pages/account";
import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";

import { getMemberProfile } from "../api/get-member-profile";
import { reportMemberProfileAction } from "../api/report-member-profile.action";
import { MemberProfileReport } from "./member-profile-report.client";

export async function MemberProfilePage({
  publicProfileId,
}: {
  readonly publicProfileId: string;
}) {
  const accessToken = await getOptionalPlatformAccessToken();
  const result = await getMemberProfile(publicProfileId, accessToken);
  if (result.kind === "not_found") notFound();

  return (
    <div className="mx-auto max-w-3xl py-4 sm:py-10">
      <MemberProfileProjection
        fields={result.profile}
        headingLevel="h1"
        label="Участник сообщества"
      />
      <MemberProfileReport
        publicProfileId={result.profile.publicProfileId}
        reportAction={reportMemberProfileAction}
      />
    </div>
  );
}
