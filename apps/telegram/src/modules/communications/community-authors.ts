import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../database/database.js";
import { platformLinksForTelegramUsers } from "../identity-linking/platform-links.js";
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

  async rolesFor(
    botIdentity: string,
    telegramUserIds: readonly string[],
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
      try {
        const permission = await authorizeAuthor(this.authorization, {
          kind: "telegram",
          accountRef: link.accountRef,
          telegramIdentityRef: link.telegramIdentityRef,
          botIdentity,
        });
        roles.set(
          link.telegramUserId,
          permission === "unavailable" ? null : permission === "allowed",
        );
      } catch (error) {
        reportFailure("community-discussions.author-authorization", error);
        roles.set(link.telegramUserId, null);
      }
    }
    return roles;
  }
}
