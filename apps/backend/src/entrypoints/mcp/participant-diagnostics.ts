import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Accounts } from "../../modules/accounts/index.js";
import { activityWindowSchema } from "../../infrastructure/confirmed-activity.js";
import type { ReadingActivityFacts } from "../../modules/reading-activity/index.js";
import type { BookmarkActivityFacts } from "../../modules/bookmarks/index.js";
import type { TaskSubmissionFacts } from "../../modules/product-tasks/index.js";
import { dependencyFailure } from "../../infrastructure/observability/index.js";

export class ParticipantDiagnostics {
  constructor(
    private readonly accounts: Pick<Accounts, "checkPermission">,
    private readonly reading: Pick<ReadingActivityFacts, "read">,
    private readonly bookmarks: Pick<BookmarkActivityFacts, "read">,
    private readonly submissions: Pick<TaskSubmissionFacts, "read">,
  ) {}

  async read(accountId: string, input: unknown) {
    const parsed = activityWindowSchema.safeParse(input);
    if (!z.uuid().safeParse(accountId).success || !parsed.success)
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
      const window = {
        from: parsed.data.from.toISOString(),
        to: parsed.data.to.toISOString(),
      };
      const sources = [];
      const accounts = new Set<string>();
      let observed = true;
      for (const [source, owner] of [
        ["reading", this.reading],
        ["bookmarks", this.bookmarks],
        ["submissions", this.submissions],
      ] as const) {
        let result;
        try {
          result = await owner.read(window);
        } catch {
          result = {
            ok: false as const,
            error: { code: "source_unavailable" as const },
          };
        }
        if (result.ok) {
          for (const row of result.value.rows) accounts.add(row.accountId);
          sources.push({
            source,
            status: "observed" as const,
            asOf: result.value.asOf,
            coverage: result.value.coverage,
          });
        } else {
          observed = false;
          sources.push({
            source,
            status: "unknown" as const,
            error: { code: result.error.code },
            asOf: null,
            coverage: {
              status: "unknown" as const,
              retentionFrom: null,
              collectionStartedAt: null,
              continuity: "not_proven" as const,
            },
          });
        }
      }
      const notCollected = { status: "not_collected" as const, count: null };
      return {
        ok: true as const,
        value: {
          window,
          calendar: "Europe/Moscow" as const,
          coverage: "partial" as const,
          membership: {
            status: observed ? ("observed" as const) : ("unknown" as const),
            count: observed ? accounts.size : null,
            coverage: "partial" as const,
          },
          sources,
          telegram: notCollected,
          combined: notCollected,
          unlinkedTelegramContacts: notCollected,
        },
      };
    } catch (error) {
      return dependencyFailure(
        { module: "ParticipantDiagnostics", operation: "read" },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }
}

export function registerParticipantDiagnosticsTool(
  server: McpServer,
  dependencies: {
    readonly accountId: string;
    readonly participants: Pick<ParticipantDiagnostics, "read">;
  },
): void {
  server.registerTool(
    "active_participant_diagnostics",
    {
      title: "Read confirmed active Membership Account counts",
      description:
        "Requires current platform:admin. Distinct Membership Accounts with confirmed learning, reading transitions, bookmarks or submissions in one explicit [from,to) interval, at most 31 days. Input accepts UTC instants or offsets; calendar is Europe/Moscow. Three independent bounded read-only database snapshots enforce a 365-day horizon. Aggregate only, no identities or events. Coverage is partial and continuity is not proven; zero is only observed zero. Any failed or overflowing source makes Membership unknown. Telegram, combined Accounts and unlinked Telegram contacts are not collected and remain unknown. No permission changes, providers or mutations.",
      inputSchema: z.strictObject({
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const result = await dependencies.participants.read(
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
