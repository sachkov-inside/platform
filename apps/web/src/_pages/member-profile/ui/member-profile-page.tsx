import { notFound } from "next/navigation";

import { getOptionalPlatformAccessToken } from "@/shared/auth/index.server";

import { getMemberProfile } from "../api/get-member-profile";
import { reportMemberProfileAction } from "../api/report-member-profile.action";
import { MemberProfileReady } from "./member-profile-ready";

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
    <MemberProfileReady
      profile={result.profile}
      reportAction={reportMemberProfileAction}
    />
  );
}
