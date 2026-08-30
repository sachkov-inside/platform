import {
  MemberProfileProjection,
  type MemberProfileProjectionData,
} from "@/_pages/account";

import {
  MemberProfileReport,
  type ProfileReportAction,
} from "./member-profile-report.client";

export function MemberProfileReady({
  profile,
  reportAction,
}: {
  readonly profile: MemberProfileProjectionData;
  readonly reportAction: ProfileReportAction;
}) {
  return (
    <div className="mx-auto max-w-3xl py-4 sm:py-10">
      <MemberProfileProjection
        fields={profile}
        headingLevel="h1"
        label="Участник сообщества"
      />
      <MemberProfileReport
        publicProfileId={profile.publicProfileId}
        reportAction={reportAction}
      />
    </div>
  );
}
