import type { WaitlistConfirmation } from "@inside/contracts/waitlist-confirmation";
import { sql } from "kysely";
import type { ApplicationConfig } from "../../config/application-config.js";
import type { Database } from "../../database/database.js";
import {
  claim,
  expireLeases,
  retryDelay,
  settle,
  type DurableQueue,
} from "../../database/durable-queue.js";
import {
  externalRead,
  transactionWithExternalReads,
} from "../../database/external-reads.js";
import { findPlatformLink } from "../identity-linking/platform-links.js";
import { findBotContact } from "../bot-contacts/contact-access.js";
import {
  reserveTelegramSlot,
  deferTelegramSlot,
} from "../outbound/telegram-transport-slots.js";
import type { Clock } from "../../shared/clock.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";
import type { CommunicationTransport } from "./communication-delivery.js";

export const WAITLIST_CONFIRMATION_AUTHORIZATION = Symbol(
  "WAITLIST_CONFIRMATION_AUTHORIZATION",
);
export interface WaitlistConfirmationAuthorization {
  current(
    command: WaitlistConfirmation,
  ): Promise<"accepted" | "suppressed" | "unavailable">;
}
const CONFIRMATION_LEASE_MS = 60_000;
const CONFIRMATION_RETRY_INITIAL_MS = 1000;
const CONFIRMATION_RETRY_MAX_MS = 4000;
const MAX_CONFIRMATION_ATTEMPTS = 3;
const queue: DurableQueue<"waitlist_confirmations"> = {
  table: "waitlist_confirmations",
  key: ["bot_identity", "event_id"],
  order: ["created_at", "event_id"],
  ready: ["pending"],
  leased: "sending",
  due: "available_at",
  attempts: "attempt_count",
  leasedAt: "attempted_at",
  leaseMs: CONFIRMATION_LEASE_MS,
  retry: {
    initialMs: CONFIRMATION_RETRY_INITIAL_MS,
    maxMs: CONFIRMATION_RETRY_MAX_MS,
  },
};
/** One fixed receipt per committed join generation, independent of marketing consent. */
export class WaitlistConfirmations {
  constructor(
    private readonly database: Database,
    private readonly config: ApplicationConfig,
    private readonly clock: Clock,
    private readonly authorization: WaitlistConfirmationAuthorization,
    private readonly transport: CommunicationTransport,
  ) {}
  async receive(
    command: WaitlistConfirmation,
  ): Promise<{ eventId: string; status: "accepted" }> {
    await this.database.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtextextended(${`waitlist-confirmation:${this.config.botIdentity}:${command.eventId}`},0))`.execute(
        tx,
      );
      const previous = await tx
        .selectFrom("waitlist_confirmations")
        .select("command")
        .where("bot_identity", "=", this.config.botIdentity)
        .where("event_id", "=", command.eventId)
        .executeTakeFirst();
      if (previous) {
        const old = previous.command;
        if (
          old.intakeId !== command.intakeId ||
          old.accountRef !== command.accountRef ||
          old.telegramIdentityRef !== command.telegramIdentityRef ||
          old.linkRevision !== command.linkRevision
        )
          throw new WaitlistConfirmationConflict();
        return;
      }
      const now = this.clock.now();
      await tx
        .insertInto("waitlist_confirmations")
        .values({
          bot_identity: this.config.botIdentity,
          event_id: command.eventId,
          command: JSON.stringify(command),
          created_at: now,
          available_at: now,
          state: "pending",
          attempted_at: null,
          provider_message_id: null,
          diagnostic_code: null,
        })
        .execute();
    });
    return { eventId: command.eventId, status: "accepted" };
  }
  /** Redacted state inventory for readiness evidence. Never returns recipient or message content. */
  async snapshot(): Promise<Record<string, number>> {
    const rows = await this.database
      .selectFrom("waitlist_confirmations")
      .select(["state", (eb) => eb.fn.countAll<string>().as("count")])
      .where("bot_identity", "=", this.config.botIdentity)
      .groupBy("state")
      .execute();
    return Object.fromEntries(
      rows.map((row) => [row.state, Number(row.count)]),
    );
  }
  async processAvailable(): Promise<number> {
    if (this.config.deliveryMode !== "live") return 0;
    const now = this.clock.now();
    const { item, chatId, suppressed } = await transactionWithExternalReads(
      this.database,
      async (tx) => {
        await expireLeases(tx, queue, now, {
          state: "unknown",
          diagnostic_code: "worker_lease_expired",
        });
        let chatId: string | undefined;
        let suppressed = false;
        const item = await claim(tx, queue, now, {
          select: ["bot_identity", "event_id", "command"],
          where: (eb) => eb("bot_identity", "=", this.config.botIdentity),
          prepare: async (tx, row) => {
            const command = row.command;
            const link = await findPlatformLink(
              tx,
              {
                botIdentity: row.bot_identity,
                accountRef: command.accountRef,
                telegramIdentityRef: command.telegramIdentityRef,
              },
              "share",
            );
            const status = link
              ? await externalRead(
                  `waitlist-confirmation:${JSON.stringify(command)}`,
                  () => this.authorization.current(command),
                )
              : "suppressed";
            if (status === "unavailable") return undefined;
            const contact = link
              ? await findBotContact(
                  tx,
                  row.bot_identity,
                  link.telegramUserId,
                  true,
                )
              : undefined;
            if (
              status !== "accepted" ||
              !link ||
              contact?.contactability !== "reachable"
            ) {
              await tx
                .updateTable("waitlist_confirmations")
                .set({
                  state: "suppressed",
                  diagnostic_code: "no_current_recipient",
                })
                .where("bot_identity", "=", row.bot_identity)
                .where("event_id", "=", row.event_id)
                .execute();
              suppressed = true;
              return undefined;
            }
            if (
              !(await reserveTelegramSlot(
                tx,
                row.bot_identity,
                contact.private_chat_id,
                now,
              ))
            )
              return undefined;
            chatId = contact.private_chat_id;
            return {};
          },
        });
        return { item, chatId, suppressed };
      },
    );
    if (!item || chatId === undefined) return suppressed ? 1 : 0;
    let result;
    try {
      result = await this.transport.send({
        chatId,
        content: {
          type: "text",
          text: "Вы находитесь в списке ожидания.",
          entities: [],
          buttons: [],
        },
      });
    } catch (error) {
      reportFailure("communications.waitlist-confirmation", error);
      result = { kind: "transport_unknown" as const };
    }
    const retry =
      result.kind === "api_retryable" &&
      item.attempt < MAX_CONFIRMATION_ATTEMPTS;
    const availableAt = new Date(
      this.clock.now().getTime() +
        (result.kind === "api_retryable"
          ? Math.max(
              retryDelay(queue, item.attempt),
              (result.retryAfterSeconds ?? 0) * 1000,
            )
          : 0),
    );
    await this.database.transaction().execute(async (tx) => {
      if (result.kind === "api_retryable" && result.providerErrorCode === 429)
        await deferTelegramSlot(tx, item.row.bot_identity, availableAt);
      await settle(tx, queue, item, {
        state:
          result.kind === "delivered"
            ? "delivered"
            : result.kind === "transport_unknown"
              ? "unknown"
              : retry
                ? "pending"
                : "rejected",
        available_at: availableAt,
        provider_message_id:
          result.kind === "delivered" ? result.providerMessageId : null,
        diagnostic_code: result.kind,
      });
    });
    return 1;
  }
}
export class WaitlistConfirmationConflict extends Error {}
