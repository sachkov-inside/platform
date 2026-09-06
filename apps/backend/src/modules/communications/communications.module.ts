import {
  MaterialContentModule,
  PublicContentTargets,
} from "../materials/index.js";
import {
  PrismaModule,
  PrismaClientProvider,
} from "../../infrastructure/prisma/index.js";
import { TrackingVisits } from "./facets/tracking-visits/tracking-visits.js";
import { TrackVisitController } from "./features/track-visit/track-visit.controller.js";
import {
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../config/platform-config.js";
import { ACCOUNTS, AccountsModule, type Accounts } from "../accounts/index.js";
import {
  TelegramAccountLinks,
  TelegramAccountLinksModule,
} from "../telegram-membership/index.js";
import { AuthorizeCommunicationsAuthorController } from "./features/authorize-author/authorize-author.controller.js";
import { ManageCommunicationsController } from "./features/manage-communications/manage-communications.controller.js";
import { Communications } from "./facets/communications/communications.js";
import { HttpCommunicationsProvider } from "./infrastructure/http-communications-provider.js";

const OUTBOX_POLL_INTERVAL_MS = 5_000;

/** API-owned event delivery; durable claims make multiple API instances safe. */
@Injectable()
export class TrackingHitPump
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  private stopped = false;
  private readonly logger = new Logger(TrackingHitPump.name);
  constructor(
    @Inject(TrackingVisits) private readonly visits: TrackingVisits,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}
  onApplicationBootstrap() {
    if (this.config.communicationsTrackingOrigin && this.config.communications)
      this.schedule();
  }
  private schedule() {
    this.timer = setTimeout(() => {
      this.active = this.visits
        .deliverPending()
        .catch(() => {
          this.logger.warn(
            "Tracking hit delivery unavailable; persisted backlog retained",
          );
        })
        .finally(() => {
          if (!this.stopped) this.schedule();
        });
    }, OUTBOX_POLL_INTERVAL_MS);
    this.timer.unref();
  }
  async onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }
}

@Module({
  imports: [
    PrismaModule,
    AccountsModule,
    TelegramAccountLinksModule,
    MaterialContentModule,
  ],
  controllers: [
    TrackVisitController,
    AuthorizeCommunicationsAuthorController,
    ManageCommunicationsController,
  ],
  exports: [Communications, TrackingVisits],
  providers: [
    {
      provide: TrackingVisits,
      inject: [PrismaClientProvider, PLATFORM_CONFIG],
      useFactory: (prisma: PrismaClientProvider, config: PlatformConfig) =>
        new TrackingVisits(
          prisma,
          new HttpCommunicationsProvider(config.communications),
          config.communicationsTrackingOrigin,
          () => {
            new Logger("TrackingVisits").error(
              "Tracking hit persistence unconfirmed; navigation continued, analytics may be incomplete",
            );
          },
        ),
    },
    {
      provide: Communications,
      inject: [
        ACCOUNTS,
        TelegramAccountLinks,
        PLATFORM_CONFIG,
        TrackingVisits,
        PublicContentTargets,
      ],
      useFactory: (
        accounts: Accounts,
        links: TelegramAccountLinks,
        config: PlatformConfig,
        visits: TrackingVisits,
        targets: PublicContentTargets,
      ) =>
        new Communications(
          accounts,
          links,
          new HttpCommunicationsProvider(config.communications),
          {
            targets,
            publicOrigin: config.communications?.publicOrigin,
            botStartUrl: config.telegramMembership.botStartUrl,
          },
          visits,
        ),
    },
  ],
})
export class CommunicationsModule {}

// Only the API owns event-delivery lifecycle; MCP reads the same durable backlog.
@Module({ imports: [CommunicationsModule], providers: [TrackingHitPump] })
export class CommunicationsTrackingDeliveryModule {}
