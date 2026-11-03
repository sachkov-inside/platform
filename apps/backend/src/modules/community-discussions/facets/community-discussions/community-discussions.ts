import { communityDiscussionsRequestSchema } from "@inside/contracts/community-discussions";
import type { Accounts } from "../../../accounts/index.js";
import type { TelegramAccountLinks } from "../../../telegram-membership/index.js";
import {
  discussionsFailure,
  type CommunityDiscussionsResult,
} from "../../community-discussions-contract.js";
import type { HttpCommunityDiscussionsProvider } from "../../infrastructure/http-community-discussions-provider.js";

export class CommunityDiscussions {
  constructor(
    private readonly accounts: Accounts,
    private readonly links: TelegramAccountLinks,
    private readonly provider: HttpCommunityDiscussionsProvider,
  ) {}

  async execute(
    accountId: string,
    input: unknown,
  ): Promise<CommunityDiscussionsResult> {
    const permission = await this.accounts.checkPermission({
      accountId,
      permission: "communications:manage",
    });
    if (!permission.ok && permission.error.code === "internal_error")
      return discussionsFailure("authorization_unavailable");
    if (!permission.ok || !permission.allowed)
      return discussionsFailure("forbidden");
    // Reject any caller-selected identity before binding the current confirmed Telegram association.
    if (
      typeof input !== "object" ||
      input === null ||
      Array.isArray(input) ||
      "actor" in input ||
      "accountId" in input
    )
      return discussionsFailure("invalid_input");
    const link = await this.links.find({ accountId });
    if (!link.ok) return discussionsFailure("authorization_unavailable");
    if (link.link === null) return discussionsFailure("link_required");
    const parsed = communityDiscussionsRequestSchema.safeParse({
      ...input,
      actor: { accountRef: link.link.accountRef },
    });
    if (!parsed.success) return discussionsFailure("invalid_input");
    return this.provider.execute(parsed.data);
  }
}
