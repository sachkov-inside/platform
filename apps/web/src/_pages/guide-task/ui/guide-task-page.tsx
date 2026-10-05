import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { readWebRuntimeConfig } from "@/shared/config/index.server";
import { guideTaskHref } from "@/shared/routing/subscription-route";

import {
  getGuideTaskPage,
  loadOwnSubmissions,
} from "../api/load-guide-task.server";
import { GuideTaskUnavailable } from "./guide-task-states";
import { GuideTaskClosed, GuideTaskView } from "./guide-task-view";

/**
 * The task page reads the session before it renders, so it is one personal layer under its route
 * skeleton, never cached: access, requirements, own submissions and the submission setting all
 * depend on the reader or change at the same address.
 */
export async function GuideTaskPage({
  params,
}: {
  readonly params: Promise<{ readonly slug: string; readonly code: string }>;
}) {
  const { slug, code } = await params;
  await connection();
  const accessToken = await getOptionalPlatformAccessToken();
  const [result, submissions] = await Promise.all([
    getGuideTaskPage(slug, code, accessToken),
    loadOwnSubmissions(code, accessToken),
  ]);
  if (result.kind === "not-found") notFound();
  if (result.kind === "unavailable") return <GuideTaskUnavailable />;
  if (result.kind === "closed") return <GuideTaskClosed task={result.task} />;
  return (
    <GuideTaskView
      learnerMcpUrl={readWebRuntimeConfig().learnerMcp.url}
      page={result.page}
      returnTo={guideTaskHref(slug, code)}
      submissions={submissions}
    />
  );
}
