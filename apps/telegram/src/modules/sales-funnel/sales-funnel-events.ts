import { createHash } from "node:crypto";
import { type Transaction } from "kysely";

import type { DatabaseSchema } from "../../database/database.js";

export const SALES_FUNNEL_EVENTS_VERSION = "inside.sales-funnel-events.v1";

/**
 * One event of `inside.sales-funnel-events.v1`. `contactRef` is the bot's opaque contact id;
 * no Telegram user id, username or name ever enters an event.
 */
export type SalesFunnelEvent = {
  readonly eventId: string;
  readonly contactRef: string;
  readonly occurredAt: string;
} & (
  | { readonly kind: "bot_entered"; readonly sourceCode: string | null }
  | { readonly kind: "marketing_consent"; readonly granted: boolean }
  | { readonly kind: "account_linked"; readonly telegramIdentityRef: string }
);

type EventFact<K extends SalesFunnelEvent["kind"]> = Omit<
  Extract<SalesFunnelEvent, { kind: K }>,
  "eventId" | "contactRef" | "occurredAt"
>;

/**
 * The event id is derived from the fact it reports, so the same fact always carries the same
 * id: a replayed update, the one-time backfill of migration 029 and a later emission converge
 * on one Platform event. SHA-256 of the name, shaped as an RFC 9562 version 8 UUID; migration
 * 029 computes the same value in SQL.
 */
export function salesFunnelEventId(name: string): string {
  const h = createHash("sha256").update(name, "utf8").digest("hex");
  const variant = "89ab"[Number.parseInt(h.charAt(16), 16) % 4] ?? "8";
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A source label Platform accepts, or null: a malformed `/start m_…` counts as unlabelled. */
export function salesFunnelSourceCode(
  source: string | undefined,
): string | null {
  return source !== undefined && /^[A-Za-z0-9_-]{1,64}$/.test(source)
    ? source
    : null;
}

/** A `/start` that entered the marketing flow; one event per Telegram update. */
export function recordBotEntered(
  tx: Transaction<DatabaseSchema>,
  entry: {
    readonly botIdentity: string;
    readonly updateId: string;
    readonly contactRef: string;
    readonly enteredAt: Date;
    readonly source: string | undefined;
  },
): Promise<void> {
  return record(
    tx,
    entry.botIdentity,
    `bot_entered:${entry.botIdentity}:${entry.updateId}`,
    entry.contactRef,
    entry.enteredAt,
    { kind: "bot_entered", sourceCode: salesFunnelSourceCode(entry.source) },
  );
}

/** An explicit consent (button, `/resume`) or its withdrawal (`/stop`). */
export function recordMarketingConsent(
  tx: Transaction<DatabaseSchema>,
  preference: {
    readonly botIdentity: string;
    readonly updateId: string;
    readonly contactRef: string;
    readonly observedAt: Date;
    readonly granted: boolean;
  },
): Promise<void> {
  return record(
    tx,
    preference.botIdentity,
    `marketing_consent:${preference.botIdentity}:${preference.updateId}`,
    preference.contactRef,
    preference.observedAt,
    { kind: "marketing_consent", granted: preference.granted },
  );
}

/** A confirmed link of a Telegram identity to a Platform Account. */
export interface ConfirmedLink {
  readonly botIdentity: string;
  readonly telegramUserId: string;
  readonly telegramIdentityRef: string;
  /** The link transaction that confirmed the current Account; a transfer brings a new one. */
  readonly linkTransactionRef: string;
  readonly linkedAt: Date;
}

/** Reports a confirmed link using the stable contact supplied by application composition. */
export async function recordAccountLinked(
  tx: Transaction<DatabaseSchema>,
  link: ConfirmedLink,
  contactRef: string,
): Promise<void> {
  await record(
    tx,
    link.botIdentity,
    `account_linked:${link.linkTransactionRef}`,
    contactRef,
    link.linkedAt,
    {
      kind: "account_linked",
      telegramIdentityRef: link.telegramIdentityRef,
    },
  );
}

async function record<K extends SalesFunnelEvent["kind"]>(
  tx: Transaction<DatabaseSchema>,
  botIdentity: string,
  name: string,
  contactRef: string,
  occurredAt: Date,
  fact: EventFact<K> & { readonly kind: K },
): Promise<void> {
  const eventId = salesFunnelEventId(name);
  const event = {
    eventId,
    contactRef,
    occurredAt: occurredAt.toISOString(),
    ...fact,
  };
  await tx
    .insertInto("sales_funnel_event_outbox")
    .values({
      event_id: eventId,
      bot_identity: botIdentity,
      kind: fact.kind,
      event: JSON.stringify(event),
      created_at: occurredAt,
      available_at: occurredAt,
    })
    .onConflict((c) => c.column("event_id").doNothing())
    .execute();
}
