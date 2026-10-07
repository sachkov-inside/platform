import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";

import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../../../config/platform-config.js";
import { reportDependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { TelegramMembership } from "../../facets/telegram-membership/telegram-membership.interface.js";
import { TELEGRAM_MEMBERSHIP } from "../../telegram-membership.tokens.js";

/** Покупатель ждёт приветствия в боте: привязку подтверждаем через секунды, а не за минуту. */
const PENDING_LINK_POLL_INTERVAL_MS = 5_000;
const PENDING_LINK_BATCH_SIZE = 20;

/**
 * API-owned pass that finishes Telegram links started in the bot, so a buyer gets the community
 * welcome without returning to the site (#1037). It runs only where the community direction is
 * configured. Several API instances may confirm the same link: the provider answers a repeated
 * confirmation as idempotent and the binding is written under the Account link lock.
 */
@Injectable()
export class PendingLinkConfirmationPump
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  private stopped = false;
  constructor(
    @Inject(TELEGRAM_MEMBERSHIP)
    private readonly membership: Pick<
      TelegramMembership,
      "confirmPendingLinks"
    >,
    @Inject(PLATFORM_CONFIG)
    private readonly config: Pick<PlatformConfig, "communityEntitlements">,
  ) {}
  onApplicationBootstrap() {
    if (this.config.communityEntitlements) this.schedule();
  }
  private schedule() {
    this.timer = setTimeout(() => {
      this.active = this.membership
        .confirmPendingLinks(PENDING_LINK_BATCH_SIZE)
        .then(() => undefined)
        // A waiting link stays in the database and is confirmed on the next tick.
        .catch((error: unknown) => {
          reportDependencyFailure(
            { module: "telegram-membership", operation: "confirmPendingLinks" },
            error,
          );
        })
        .finally(() => {
          if (!this.stopped) this.schedule();
        });
    }, PENDING_LINK_POLL_INTERVAL_MS);
    this.timer.unref();
  }
  async onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }
}
