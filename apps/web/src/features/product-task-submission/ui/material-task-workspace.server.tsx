import "server-only";
import { connection as requestConnection } from "next/server";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { getQueryClient } from "@/shared/api/query-client";
import {
  BackendConnectionError,
  requestMaterialTaskPage,
} from "@/shared/api/backend/index.server";
import { getOptionalPlatformAccessToken } from "@/shared/auth/optional-platform-access-token.server";
import { productTaskPageSchema } from "../model/product-task-page";
import { prefetchOwnTaskSubmissions } from "../api/load-product-task.server";
import { TaskSubmissionWorkspace } from "./task-submission-workspace";

/** Personal optional island: neither its access check nor its failure gates the lesson body. */
export async function MaterialTaskWorkspace({
  materialId,
  connection,
  returnTo,
  attemptsAfter,
  conflictingAnchorIds,
}: {
  readonly materialId: string;
  readonly connection: Promise<{
    readonly url: string;
    readonly setupUrl: string;
    readonly prompt: string;
  }>;
  readonly returnTo: string;
  readonly attemptsAfter?: string | undefined;
  readonly conflictingAnchorIds: readonly string[];
}) {
  await requestConnection();
  const result = await loadWorkspace(materialId, attemptsAfter, connection);
  if (result.kind === "unbound") return null;
  if (result.kind === "unavailable") return <WorkspaceUnavailable />;
  if (result.kind === "closed")
    return (
      <section
        className="mt-12 border-t border-border pt-6"
        aria-label="Практика"
      >
        <p>Практика недоступна для твоего аккаунта.</p>
      </section>
    );
  return (
    <HydrationBoundary state={result.hydration}>
      <TaskSubmissionWorkspace
        code={result.page.task.code}
        version={result.page.task.version}
        accepting={result.page.submission.accepting}
        history={result.submissions}
        accountId={result.accountId}
        connectionPrompt={result.connection.prompt}
        learnerMcpUrl={result.connection.url}
        learnerMcpSetupUrl={result.connection.setupUrl}
        returnTo={returnTo}
        attemptsAfter={attemptsAfter}
        conflictingAnchorIds={conflictingAnchorIds}
      />
    </HydrationBoundary>
  );
}

async function loadWorkspace(
  materialId: string,
  after: string | undefined,
  connection: Promise<{
    readonly url: string;
    readonly setupUrl: string;
    readonly prompt: string;
  }>,
) {
  try {
    const [accessToken, resolvedConnection] = await Promise.all([
      getOptionalPlatformAccessToken(),
      connection,
    ]);
    const result = await requestMaterialTaskPage(
      materialId,
      accessToken === undefined ? {} : { accessToken },
    );
    if (!result.ok) {
      if (result.response.status === 404) return { kind: "unbound" as const };
      return { kind: "unavailable" as const };
    }
    const parsed = productTaskPageSchema.safeParse(result.body);
    if (!parsed.success) return { kind: "unavailable" as const };
    const page = parsed.data;
    if (page.access === "closed") return { kind: "closed" as const };
    const client = getQueryClient();
    const personal = await prefetchOwnTaskSubmissions(
      client,
      page.task.code,
      accessToken,
      after,
    );
    return {
      kind: "ready" as const,
      page,
      ...personal,
      hydration: dehydrate(client),
      connection: resolvedConnection,
    };
  } catch (error) {
    if (error instanceof BackendConnectionError)
      return { kind: "unavailable" as const };
    throw error;
  }
}
function WorkspaceUnavailable() {
  return (
    <section className="mt-12 border-t border-border pt-6" role="status">
      <p>Практика сейчас не загрузилась. Обнови страницу, чтобы повторить.</p>
    </section>
  );
}
