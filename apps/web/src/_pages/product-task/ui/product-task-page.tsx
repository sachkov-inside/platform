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
}: {
  readonly params: Promise<{ readonly slug: string; readonly code: string }>;
}) {
  const { slug, code } = await params;
  await connection();
  const accessToken = await getOptionalPlatformAccessToken();
  const [result, submissions] = await Promise.all([
    getProductTaskPage(slug, code, accessToken),
    loadOwnSubmissions(code, accessToken),
  ]);
  if (result.kind === "not-found") notFound();
  if (result.kind === "unavailable") return <ProductTaskUnavailable />;
  if (result.kind === "closed") return <ProductTaskClosed task={result.task} />;
  return (
    <ProductTaskView
      learnerMcpUrl={readWebRuntimeConfig().learnerMcp.url}
      page={result.page}
      returnTo={productTaskHref(slug, code)}
      submissions={submissions}
    />
  );
}
