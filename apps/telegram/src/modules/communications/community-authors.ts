import { randomUUID } from "node:crypto";
import type { Transaction } from "kysely";
import type { DatabaseSchema } from "../../database/database.js";
import { enqueueAuthorMessage } from "./author-delivery.js";
import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../database/database.js";
import {
  botPlatformLinksPage,
  type PlatformLink,
  findPlatformLink,
  platformLinksForTelegramUsers,
} from "../identity-linking/platform-links.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";
import {
  AUTHOR_AUTHORIZATION,
  authorizeAuthor,
  type AuthorAuthorization,
} from "./author-authorization.js";

/** A confirmed linked Account with communications:manage authors community answers. */
@Injectable()
export class CommunityAuthors {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AUTHOR_AUTHORIZATION)
    private readonly authorization: AuthorAuthorization,
  ) {}

  /** Authorization runs outside a database transaction, with at most five callbacks per page. */
  async budgetNoticeCandidate(
    botIdentity: string,
    after?: string,
  ): Promise<{ recipient: PlatformLink | null; nextAfter: string | null }> {
    const page = await botPlatformLinksPage(this.database, botIdentity, after);
    for (const candidate of page) {
      const permission = await authorizeAuthor(this.authorization, {
        kind: "telegram",
        accountRef: candidate.accountRef,
        telegramIdentityRef: candidate.telegramIdentityRef,
        botIdentity,
      });
      if (permission === "allowed")
        return { recipient: candidate, nextAfter: null };
    }
    return {
      recipient: null,
      nextAfter:
        page.length === 5 ? (page.at(-1)?.telegramUserId ?? null) : null,
    };
  }

  /** Delivery rechecks permission; enqueue pins the confirmed binding in the caller's transaction. */
  async enqueueBudgetNotice(
    tx: Transaction<DatabaseSchema>,
    candidate: PlatformLink,
    month: string,
    now: Date,
  ): Promise<boolean> {
    const botIdentity = candidate.botIdentity;
    const link = await findPlatformLink(
      tx,
      {
        botIdentity,
        telegramUserId: candidate.telegramUserId,
        accountRef: candidate.accountRef,
      },
      "share",
    );
    if (!link || link.telegramIdentityRef !== candidate.telegramIdentityRef)
      return false;
    await enqueueAuthorMessage(tx, {
      deliveryId: randomUUID(),
      botIdentity,
      accountRef: link.accountRef,
      telegramUserId: link.telegramUserId,
      telegramIdentityRef: link.telegramIdentityRef,
      message: {
        chatId: link.telegramUserId,
        content: {
          type: "text",
          entities: [],
          buttons: [],
          text: `Достигнут предел расходов на обсуждения сообщества за ${month}. Обработка продолжится после повышения предела или в следующем месяце.`,
        },
      },
      now,
    });
    return true;
  }

  async rolesFor(
    botIdentity: string,
    telegramUserIds: readonly string[],
    signal?: AbortSignal,
  ): Promise<ReadonlyMap<string, boolean | null>> {
    const roles = new Map<string, boolean | null>(
      telegramUserIds.map((id) => [id, false]),
    );
    const links = await platformLinksForTelegramUsers(
      this.database,
      botIdentity,
      telegramUserIds,
    );
    for (const link of links) {
      signal?.throwIfAborted();
      try {
        const permission = await authorizeAuthor(this.authorization, {
          kind: "telegram",
          accountRef: link.accountRef,
          telegramIdentityRef: link.telegramIdentityRef,
          botIdentity,
        });
        signal?.throwIfAborted();
        roles.set(
          link.telegramUserId,
          permission === "unavailable" ? null : permission === "allowed",
        );
      } catch (error) {
        signal?.throwIfAborted();
        reportFailure("community-discussions.author-authorization", error);
        roles.set(link.telegramUserId, null);
      }
    }
    return roles;
  }
}
