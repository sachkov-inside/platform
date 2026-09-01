import {
  MemberProfileProjection,
  type MemberProfileProjectionData,
} from "@/_pages/account";

export function MemberProfileReady({ profile }: {
  readonly profile: MemberProfileProjectionData;
}) {
  return (
    <div className="mx-auto max-w-3xl py-4 sm:py-10">
      <MemberProfileProjection
        fields={profile}
        headingLevel="h1"
        label="Участник сообщества"
      />
    </div>
  );
}
