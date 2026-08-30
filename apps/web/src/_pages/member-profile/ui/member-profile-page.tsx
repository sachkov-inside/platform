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
  if (result.kind === "unavailable") {
    return (
      <section className="mx-auto max-w-xl py-16">
        <h1 className="text-4xl font-bold tracking-[-0.04em]">
          Профиль временно недоступен
        </h1>
        <p className="mt-4 text-muted-foreground">
          Данные не удалось загрузить. Повторите попытку позже.
        </p>
        <a
          className="mt-6 inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-semibold"
          href={`/members/${publicProfileId}`}
        >
          Повторить
        </a>
        <p className="mt-4 font-mono text-xs text-muted-foreground">
          Код: {result.reference}
        </p>
      </section>
    );
  }

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
