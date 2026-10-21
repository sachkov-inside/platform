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
      const sources = [];
      for (const [source, owner] of [
        ["learning_started", this.reading],
        ["bookmarks", this.bookmarks],
      ] as const) {
        try {
          sources.push({ source, result: await owner.status() });
        } catch {
          sources.push({
            source,
            result: {
              ok: false as const,
              status: "unknown" as const,
              error: { code: "source_unavailable" as const },
            },
          });
        }
      }
      return { ok: true as const, value: { sources } };
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
        "Requires current platform:admin. Read-only bounded status of the two Membership analytics-copy journals: learning_started_events and bookmarks.activity_events. Database UTC asOf/cutoff, oldest expired row and lag, never a full backlog count. 365-day horizon, independent source snapshots, 2s statement/5s transaction/1s acquire bounds. Source failure is unknown, never zero. No cleanup, identities, original learning/bookmark/submission data changes, providers or caller-selected tables. This does not prove next-day cleanup, worker freshness or physical disk reclamation.",
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
