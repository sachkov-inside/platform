import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import {
  waitlistConfirmationResultSchema,
  type WaitlistConfirmation,
} from "@inside/contracts/waitlist-confirmation";
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
        .dispatchConfirmations((command) => {
          const config = this.config.communications;
          return config === undefined
            ? Promise.resolve("unavailable" as const)
            : deliverWaitlistConfirmation(config, command);
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

/** One provider HTTP boundary, with redacted cause diagnostics for every unavailable response. */
export async function deliverWaitlistConfirmation(
  config: Pick<
    NonNullable<PlatformConfig["communications"]>,
    "endpoint" | "secret"
  >,
  command: WaitlistConfirmation,
  fetcher: typeof fetch = fetch,
): Promise<"accepted" | "suppressed" | "unavailable"> {
  try {
    const response = await fetcher(config.endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(CONFIRMATION_REQUEST_TIMEOUT_MS),
      headers: {
        authorization: `Bearer ${config.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });
    if (!response.ok)
      throw new Error(`Waitlist confirmation provider HTTP ${response.status}`);
    const parsed = waitlistConfirmationResultSchema.safeParse(
      await response.json(),
    );
    if (!parsed.success)
      throw new Error("Waitlist confirmation provider malformed response");
    if (parsed.data.eventId !== command.eventId)
      throw new Error("Waitlist confirmation provider event mismatch");
    return parsed.data.status;
  } catch (error) {
    reportDependencyFailure(
      { module: "sales-funnel", operation: "deliverWaitlistConfirmation" },
      error,
    );
    return "unavailable";
  }
}
