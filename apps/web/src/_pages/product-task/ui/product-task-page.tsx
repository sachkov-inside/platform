import { courseReadingContext } from "@/features/library-discovery";
import { BackendConnectionError } from "@/shared/api/backend/index.server";
import { loadPublishedSeries } from "@/features/library-discovery.server";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { readWebRuntimeConfig } from "@/shared/config/index.server";
import { productTaskHref } from "@/shared/routing/subscription-route";

import {
  getProductTaskPage,
  loadOwnSubmissions,
} from "../api/load-product-task.server";
import { ProductTaskUnavailable } from "./product-task-states";
import { ProductTaskClosed, ProductTaskView } from "./product-task-view";

/**
 * The task page reads the session before it renders, so it is one personal layer under its route
 * skeleton, never cached: access, requirements, own submissions and the submission setting all
 * depend on the reader or change at the same address.
 */
export async function ProductTaskPage({
  params,
  searchParams,
}: {
  readonly searchParams?: Promise<{
    readonly attemptsAfter?: string | readonly string[];
  }>;
  readonly params: Promise<{ readonly slug: string; readonly code: string }>;
}) {
  const [{ slug, code }, query] = await Promise.all([
    params,
    searchParams ?? Promise.resolve({ attemptsAfter: undefined }),
  ]);
  const after =
    typeof query.attemptsAfter === "string" ? query.attemptsAfter : undefined;
  await connection();
  const accessToken = await getOptionalPlatformAccessToken();
  const [result, submissions, series] = await Promise.all([
    getProductTaskPage(slug, code, accessToken),
    loadOwnSubmissions(code, accessToken, after),
    loadTaskProgramme(slug, accessToken),
  ]);
  if (result.kind === "not-found") notFound();
  if (result.kind === "unavailable") return <ProductTaskUnavailable />;
  const programme =
    (series?.kind === "ready" || series?.kind === "empty") &&
    series.reference.slug === slug
      ? courseReadingContext({ series, current: { kind: "task", code } })
      : null;
  if (result.kind === "closed")
    return <ProductTaskClosed task={result.task} programme={programme} />;
  return (
    <ProductTaskView
      learnerMcpUrl={readWebRuntimeConfig().learnerMcp.url}
      page={result.page}
      programme={programme}
      returnTo={productTaskHref(slug, code)}
      submissions={submissions}
    />
  );
}

/** Navigation is supplementary: a failed composition read leaves the authorized task and form usable. */
async function loadTaskProgramme(slug: string, token: string | undefined) {
  try {
    return await loadPublishedSeries(slug, token);
  } catch (error) {
    if (error instanceof BackendConnectionError) return null;
    throw error;
  }
}
