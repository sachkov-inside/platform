import { hasText } from "../../shared/text.js";
import {
  waitlistConfirmationResultSchema,
  type WaitlistConfirmation,
} from "@inside/contracts/waitlist-confirmation";
import type { WaitlistConfirmationAuthorization } from "../../modules/communications/waitlist-confirmations.js";
import { readBoundedJson } from "./read-bounded-json.js";
import { reportFailure } from "../../shared/failure-diagnostics.js";
const CONFIRMATION_AUTHORIZATION_TIMEOUT_MS = 5000;

/** Uses the existing private waitlist boundary; a receipt never authorizes a marketing audience. */
export class HttpWaitlistConfirmationAdapter implements WaitlistConfirmationAuthorization {
  constructor(
    private readonly authorizationEndpoint: string | undefined,
    private readonly secret: string | undefined,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  async current(
    command: WaitlistConfirmation,
  ): Promise<"accepted" | "suppressed" | "unavailable"> {
    if (!hasText(this.authorizationEndpoint) || !hasText(this.secret))
      return "unavailable";
    const signal = AbortSignal.timeout(CONFIRMATION_AUTHORIZATION_TIMEOUT_MS);
    try {
      const response = await this.fetcher(
        new URL("waitlist", this.authorizationEndpoint),
        {
          method: "POST",
          redirect: "error",
          signal,
          headers: {
            authorization: `Bearer ${this.secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(command),
        },
      );
      if (!response.ok) return "unavailable";
      const parsed = waitlistConfirmationResultSchema.safeParse(
        await readBoundedJson(response, 1024, signal),
      );
      return parsed.success && parsed.data.eventId === command.eventId
        ? parsed.data.status
        : "unavailable";
    } catch (error) {
      reportFailure("platform.waitlist-confirmation", error);
      return "unavailable";
    }
  }
}
