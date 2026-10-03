import { isDeepStrictEqual } from "node:util";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { SalesFunnelPrismaClient } from "../../../../infrastructure/prisma/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import {
  botEventColumns,
  botEventDeliverySchema,
  SALES_FUNNEL_EVENTS_VERSION,
  type BotEventReceipt,
} from "../../domain/bot-events.js";

export type RecordBotEventsResult =
  | { readonly ok: true; readonly value: BotEventReceipt }
  | {
      readonly ok: false;
      readonly error: {
        readonly code:
          "invalid_request" | "event_conflict" | "dependency_unavailable";
      };
    };

type EventColumns = ReturnType<typeof botEventColumns>;

class EventConflict extends Error {}

/**
 * Принимает пачку событий бота. Повтор события с тем же содержимым безопасен; тот же
 * `eventId` с другим содержимым отклоняет всю пачку, чтобы бот увидел ошибку контракта.
 * Аккаунт привязки запоминается сразу: так метка остаётся у аккаунта и после отвязки Telegram.
 */
export async function recordBotEvents(
  dependencies: {
    readonly prisma: SalesFunnelPrismaClient;
    readonly links: Pick<TelegramAccountLinks, "findCurrentAccounts">;
    readonly clock: () => Date;
  },
  input: unknown,
): Promise<RecordBotEventsResult> {
  const parsed = botEventDeliverySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
  const incoming = new Map<string, EventColumns>();
  for (const event of parsed.data.events) {
    const columns = botEventColumns(event);
    const earlier = incoming.get(columns.eventId);
    if (earlier !== undefined && !isDeepStrictEqual(earlier, columns))
      return { ok: false, error: { code: "event_conflict" } };
    incoming.set(columns.eventId, columns);
  }
  const receivedAt = dependencies.clock();
  // Read before the transaction: the link belongs to another Module and its own connection.
  const linked = await dependencies.links.findCurrentAccounts(
    [...incoming.values()].flatMap((columns) =>
      columns.telegramIdentityRef === null ? [] : [columns.telegramIdentityRef],
    ),
  );
  // An unresolved link is not lost: the report resolves it again when it is read.
  const accountOf = (identityRef: string | null) =>
    identityRef === null || !linked.ok
      ? null
      : (linked.accounts.get(identityRef) ?? null);
  try {
    const accepted = await dependencies.prisma.$transaction(async (tx) => {
      const created = await tx.salesFunnelBotEvent.createMany({
        data: [...incoming.values()].map((columns) => ({
          ...columns,
          accountId: accountOf(columns.telegramIdentityRef),
          receivedAt,
        })),
        skipDuplicates: true,
      });
      const stored = await tx.salesFunnelBotEvent.findMany({
        where: { eventId: { in: [...incoming.keys()] } },
        select: {
          eventId: true,
          contactRef: true,
          kind: true,
          sourceCode: true,
          granted: true,
          telegramIdentityRef: true,
          occurredAt: true,
        },
      });
      if (
        stored.some((row) => !isDeepStrictEqual(row, incoming.get(row.eventId)))
      )
        throw new EventConflict();
      return created.count;
    });
    return {
      ok: true,
      value: {
        contractVersion: SALES_FUNNEL_EVENTS_VERSION,
        accepted,
        duplicates: parsed.data.events.length - accepted,
      },
    };
  } catch (error) {
    if (error instanceof EventConflict)
      return { ok: false, error: { code: "event_conflict" } };
    return dependencyFailure(
      { module: "sales-funnel", operation: "recordBotEvents" },
      error,
      { ok: false, error: { code: "dependency_unavailable" } } as const,
    );
  }
}
