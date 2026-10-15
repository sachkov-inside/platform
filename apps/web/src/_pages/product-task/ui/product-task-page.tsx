import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/shared/api/query-client";
import { resolveAccount } from "@/shared/api/backend/index.server";
import { taskSubmissionsQueryKey } from "../model/task-submissions-query";
import {
  publicPageUrl,
  readPublicSiteOrigin,
} from "@/shared/link-preview/index.server";
import { courseReadingContext } from "@/features/library-discovery";
import { BackendConnectionError } from "@/shared/api/backend/index.server";
import {
  loadPublishedSeries,
  readPublicSeries,
} from "@/features/library-discovery.server";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { readWebRuntimeConfig } from "@/shared/config/index.server";
import { productTaskHref } from "@/shared/routing/subscription-route";

import {
  getProductTaskPage,
  loadOwnSubmissions,
} from "../api/load-product-task.server";
import {
  ProductTaskLoading,
  ProductTaskPending,
  ProductTaskUnavailable,
} from "./product-task-states";
import { ProductTaskClosed, ProductTaskView } from "./product-task-view";

/**
 * Prefetch only the public course composition. Task access, requirements, submissions and
 * submission settings remain in the uncached personal boundary, like protected lesson bodies.
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
  const { slug, code } = await params;
  const series = await loadPublicTaskProgramme(slug);
  const programme =
    (series?.kind === "ready" || series?.kind === "empty") &&
    series.reference.slug === slug
      ? courseReadingContext({ series, current: { kind: "task", code } })
      : null;
  return (
    <Suspense
      fallback={
        programme === null ? (
          <ProductTaskLoading />
        ) : (
          <ProductTaskPending programme={programme} />
        )
      }
    >
      <PersonalProductTask
        code={code}
        slug={slug}
        searchParams={searchParams}
      />
    </Suspense>
  );
}

async function PersonalProductTask({
  code,
  slug,
  searchParams,
}: {
  readonly code: string;
  readonly slug: string;
  readonly searchParams:
    | Promise<{ readonly attemptsAfter?: string | readonly string[] }>
    | undefined;
}) {
  await connection();
  const query = await (searchParams ??
    Promise.resolve({ attemptsAfter: undefined }));
  const after =
    typeof query.attemptsAfter === "string" ? query.attemptsAfter : undefined;
  const accessToken = await getOptionalPlatformAccessToken();
  const client = getQueryClient();
  let accountId: string | null = null;
  if (accessToken !== undefined) {
    try {
      accountId = (await resolveAccount(accessToken)).accountId;
    } catch (error) {
      if (!(error instanceof BackendConnectionError)) throw error;
    }
  }
  const [result, submissions, series] = await Promise.all([
    getProductTaskPage(slug, code, accessToken),
    client.query({
      queryKey: taskSubmissionsQueryKey(accountId, code, after),
      queryFn: () => loadOwnSubmissions(code, accessToken, after),
    }),
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
    <HydrationBoundary state={dehydrate(client)}>
      <ProductTaskView
        accountId={accountId}
        learnerMcpUrl={readWebRuntimeConfig().learnerMcp.url}
        learnerMcpSetupUrl={publicPageUrl(
          await readPublicSiteOrigin(),
          "/practice-review-setup.txt",
        )}
        {...(after === undefined ? {} : { attemptsAfter: after })}
        page={result.page}
        programme={programme}
        returnTo={productTaskHref(slug, code)}
        submissions={submissions}
      />
    </HydrationBoundary>
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

/** A failed guest composition must not hide an otherwise authorized task. */
async function loadPublicTaskProgramme(slug: string) {
  try {
    return await readPublicSeries(slug);
  } catch (error) {
    if (error instanceof BackendConnectionError) return null;
    throw error;
  }
}
