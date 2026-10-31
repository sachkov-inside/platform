import { z } from "zod";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { observeTelegramHttp } from "../../../../infrastructure/observability/technical-telemetry.js";
import type { TelegramSignInProvider } from "./telegram-account-sign-in.js";
import { hasText } from "../../../../infrastructure/contracts/text.js";
const responseSchema = z
  .object({
    contractVersion: z.literal("inside.bot-sign-in.v1"),
    status: z.literal("linked"),
    telegramIdentityRef: z.uuid(),
  })
  .strict();
const providerTimeoutMilliseconds = 5000;
export class HttpTelegramSignInProvider implements TelegramSignInProvider {
  constructor(
    private readonly endpoint: string,
    private readonly secret: string | undefined,
  ) {}
  async bindAccount(
    requestRef: string,
    subjectRef: string,
    principalRef: string,
  ) {
    if (!hasText(this.secret)) return { status: "unavailable" } as const;
    return observeTelegramHttp("signin.bindAccount", async (observation) => {
      try {
        const url = `${this.endpoint}/integrations/identity/v1/sign-in/${requestRef}/account-link`;
        const init = {
          method: "POST",
          redirect: "error" as const,
          signal: AbortSignal.timeout(providerTimeoutMilliseconds),
          headers: {
            authorization: `Bearer ${this.secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contractVersion: "inside.bot-sign-in.v1",
            subjectRef,
            accountRef: principalRef,
          }),
        };
        observation.admit();
        const response = await fetch(url, init);
        observation.response(response.status);
        if (!response.ok) return { status: "unavailable" } as const;
        const body: unknown = await response.json();
        const parsed = responseSchema.safeParse(body);
        if (parsed.success) {
          observation.completed();
          return {
            status: "linked",
            telegramIdentityRef: parsed.data.telegramIdentityRef,
          } as const;
        }
        const conflict = z
          .object({ status: z.literal("conflict") })
          .safeParse(body).success;
        if (conflict) observation.completed();
        return {
          status: conflict ? "conflict" : "unavailable",
        } as const;
      } catch (error) {
        return dependencyFailure(
          { module: "telegram-membership", operation: "bindAccount" },
          error,
          { status: "unavailable" } as const,
        );
      }
    });
  }
}
