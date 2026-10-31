import { hasText } from "../../shared/text.js";
import {
  waitlistConfirmationResultSchema,
  type WaitlistConfirmation,
} from "@inside/contracts/waitlist-confirmation";
import type { WaitlistConfirmationAuthorization } from "../../modules/communications/waitlist-confirmations.js";
import { readBoundedJson } from "./read-bounded-json.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";
import {
  disabledTelegramObservability,
  type TelegramObservability,
} from "../../observability/telegram-observability.js";
const CONFIRMATION_AUTHORIZATION_TIMEOUT_MS = 5000;

/** Uses the existing private waitlist boundary; a receipt never authorizes a marketing audience. */
export class HttpWaitlistConfirmationAdapter implements WaitlistConfirmationAuthorization {
  constructor(
    private readonly authorizationEndpoint: string | undefined,
    private readonly secret: string | undefined,
    private readonly fetcher: typeof fetch = fetch,
    private readonly telemetry: TelegramObservability = disabledTelegramObservability,
  ) {}
  async current(
    command: WaitlistConfirmation,
    parent: string | null = null,
  ): Promise<"accepted" | "suppressed" | "unavailable"> {
    if (!hasText(this.authorizationEndpoint) || !hasText(this.secret))
      return "unavailable";
    return this.telemetry.runAuthorization(parent, async (wire) => {
      let outcome: "accepted" | "suppressed" | "unavailable" = "unavailable";
      const signal = AbortSignal.timeout(CONFIRMATION_AUTHORIZATION_TIMEOUT_MS);
      try {
        const traceparent = wire.traceparent();
        const response = await this.fetcher(
          new URL("waitlist", this.authorizationEndpoint),
          {
            method: "POST",
            redirect: "error",
            signal,
            headers: {
              authorization: `Bearer ${this.secret}`,
              "content-type": "application/json",
              ...(traceparent === undefined ? {} : { traceparent }),
            },
            body: JSON.stringify(command),
          },
        );
        wire.response(response.status);
        if (!response.ok) return "unavailable";
        const parsed = waitlistConfirmationResultSchema.safeParse(
          await readBoundedJson(response, 1024, signal),
        );
        outcome =
          parsed.success && parsed.data.eventId === command.eventId
            ? parsed.data.status
            : "unavailable";
        return outcome;
      } catch (error) {
        reportFailure("platform.waitlist-confirmation", error);
        return "unavailable";
      } finally {
        wire.complete(outcome);
      }
    });
  }
}
