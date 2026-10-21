import { Inject, Injectable } from "@nestjs/common";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { ACCOUNTS, type Accounts } from "../../modules/accounts/index.js";
import { PgBossQueueDiagnostics } from "../../infrastructure/pg-boss-queue-diagnostics.js";
import { dependencyFailure } from "../../infrastructure/observability/index.js";

const querySchema = z.strictObject({});

@Injectable()
export class QueueDiagnostics {
  constructor(
    @Inject(ACCOUNTS)
    private readonly accounts: Pick<Accounts, "checkPermission">,
    @Inject(PgBossQueueDiagnostics)
    private readonly queues: Pick<PgBossQueueDiagnostics, "read">,
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
      return await this.queues.read();
    } catch (error) {
      return dependencyFailure(
        { module: "QueueDiagnostics", operation: "read" },
        error,
        {
          ok: false as const,
          error: { code: "dependency_unavailable" as const },
        },
      );
    }
  }
}

export function registerQueueDiagnosticsTool(
  server: McpServer,
  dependencies: {
    readonly accountId: string;
    readonly queues: Pick<QueueDiagnostics, "read">;
  },
): void {
  server.registerTool(
    "operational_queue_diagnostics",
    {
      title: "Read Platform pg-boss queue diagnostics",
      description:
        "Requires platform:admin. Read-only aggregate snapshot of ten fixed Platform pg-boss queues: retained job states, backlog (created/retry including scheduled/blocked), ready, scheduled, blocked, retrying unfinished jobs, retained retry attempts, oldest backlog age. No payloads, job IDs, providers or queue mutations. 2s statement/5s transaction/1s connection budgets; schema/source/budget failure is unknown, never zero. asOf is a UTC database snapshot, not proof of worker freshness. Last successful work is unknown; failed/completed jobs do not establish external delivery or monetary effect outcomes. Retention may remove job history. RabbitMQ/outbox/email diagnostics are not covered.",
      inputSchema: querySchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (input) => {
      const result = await dependencies.queues.read(
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
