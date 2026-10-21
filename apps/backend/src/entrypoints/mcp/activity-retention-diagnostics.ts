import type { PgBossQueueDiagnostics } from "../../infrastructure/pg-boss-queue-diagnostics.js";
import { activityRetentionReceiptUnknown } from "../../infrastructure/activity-retention.js";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Accounts } from "../../modules/accounts/index.js";
import type { ReadingActivityRetention } from "../../modules/reading-activity/index.js";
import type { BookmarkActivityRetention } from "../../modules/bookmarks/index.js";
import { dependencyFailure } from "../../infrastructure/observability/index.js";

const querySchema = z.strictObject({});

export class ActivityRetentionDiagnostics {
  constructor(
    private readonly accounts: Pick<Accounts, "checkPermission">,
    private readonly reading: Pick<ReadingActivityRetention, "status">,
    private readonly bookmarks: Pick<BookmarkActivityRetention, "status">,
    private readonly receipts: Pick<
      PgBossQueueDiagnostics,
      "readActivityRetentionLastPass"
    >,
  ) {}

  async read(accountId: string, input: unknown) {
    if (
      !z.uuid().safeParse(accountId).success ||
      !querySchema.safeParse(input).success
    )
      return {
        ok: false as const,
        error: { code: "invalid_request" as const },
      };
    try {
      const permission = await this.accounts.checkPermission({
        accountId,
        permission: "platform:admin",
      });
      if (!permission.ok && permission.error.code === "internal_error")
        return {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        };
      if (!permission.ok || !permission.allowed)
        return { ok: false as const, error: { code: "forbidden" as const } };
      const owners = [
        ["learning_started", this.reading],
        ["bookmarks", this.bookmarks],
      ] as const;
      const sourceReads = owners.map(async ([source, owner]) => {
        try {
          return { source, result: await owner.status() };
        } catch {
          return {
            source,
            result: {
              ok: false as const,
              status: "unknown" as const,
              error: { code: "source_unavailable" as const },
            },
          };
        }
      });
      const receiptRead = (async () => {
        try {
          return await this.receipts.readActivityRetentionLastPass();
        } catch {
          return activityRetentionReceiptUnknown("source_unavailable");
        }
      })();
      const [sources, lastPass] = await Promise.all([
        Promise.all(sourceReads),
        receiptRead,
      ]);
      return { ok: true as const, value: { sources, lastPass } };
    } catch (error) {
      return dependencyFailure(
        { module: "ActivityRetentionDiagnostics", operation: "read" },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }
}

export function registerActivityRetentionDiagnosticsTool(
  server: McpServer,
  dependencies: {
    readonly accountId: string;
    readonly retention: Pick<ActivityRetentionDiagnostics, "read">;
  },
): void {
  server.registerTool(
    "activity_retention_diagnostics",
    {
      title: "Read Membership analytics-copy retention status",
      description:
        "Requires current platform:admin. Read-only bounded status of the two Membership analytics-copy journals: learning_started_events and bookmarks.activity_events. Database UTC asOf/cutoff, oldest expired row and lag, never a full backlog count. 365-day horizon, independent source snapshots, 2s statement/5s transaction/1s acquire bounds. Source failure is unknown, never zero. A third bounded fixed-queue read exposes only a validated <=4096-byte last terminal pass aggregate, including partial failure; retained queue overflow or invalid/missing latest report stays unknown, with no fallback to earlier success. Pass age over 600 seconds is stale, otherwise recent, neither proves worker health. After authorization, the three independent reads run concurrently with at most 6 seconds acquisition/transaction allowance for their composition, plus the existing authorization check. Actual end-to-end latency remains unverified. No cleanup, identities, original learning/bookmark/submission data changes, providers or caller-selected tables. This does not prove next-day cleanup, worker freshness or physical disk reclamation.",
      inputSchema: querySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const result = await dependencies.retention.read(
        dependencies.accountId,
        input,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        ...(!result.ok ? { isError: true } : {}),
      };
    },
  );
}
