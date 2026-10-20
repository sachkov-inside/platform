import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { waitlistConfirmationResultSchema } from "@inside/contracts/waitlist-confirmation";
import {
  PLATFORM_CONFIG,
  type PlatformConfig,
} from "../../../../config/platform-config.js";
import { reportDependencyFailure } from "../../../../infrastructure/observability/index.js";
import { ProductWaitlists } from "../../facets/product-waitlists/product-waitlists.js";

const CONFIRMATION_POLL_INTERVAL_MS = 5000;
const CONFIRMATION_REQUEST_TIMEOUT_MS = 5000;

/** The API relays committed receipts. Old providers return an error and leave the outbox pending. */
@Injectable()
export class WaitlistConfirmationPump
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: ReturnType<typeof setTimeout>;
  private active?: Promise<unknown>;
  private stopped = false;
  constructor(
    @Inject(ProductWaitlists) private readonly waitlists: ProductWaitlists,
    @Inject(PLATFORM_CONFIG) private readonly config: PlatformConfig,
  ) {}
  onApplicationBootstrap() {
    if (this.config.communications) this.schedule();
  }
  private schedule() {
    this.timer = setTimeout(() => {
      this.active = this.waitlists
        .dispatchConfirmations(async (command) => {
          const config = this.config.communications;
          if (!config) return "unavailable";
          try {
            const response = await fetch(config.endpoint, {
              method: "POST",
              redirect: "error",
              signal: AbortSignal.timeout(CONFIRMATION_REQUEST_TIMEOUT_MS),
              headers: {
                authorization: `Bearer ${config.secret}`,
                "content-type": "application/json",
              },
              body: JSON.stringify(command),
            });
            if (!response.ok) return "unavailable";
            const parsed = waitlistConfirmationResultSchema.safeParse(
              await response.json(),
            );
            return parsed.success && parsed.data.eventId === command.eventId
              ? parsed.data.status
              : "unavailable";
          } catch (error) {
            reportDependencyFailure(
              {
                module: "sales-funnel",
                operation: "deliverWaitlistConfirmation",
              },
              error,
            );
            return "unavailable";
          }
        })
        .catch((error: unknown) => {
          reportDependencyFailure(
            { module: "sales-funnel", operation: "dispatchConfirmations" },
            error,
          );
        })
        .finally(() => {
          if (!this.stopped) this.schedule();
        });
    }, CONFIRMATION_POLL_INTERVAL_MS);
    this.timer.unref();
  }
  async onApplicationShutdown() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }
}
