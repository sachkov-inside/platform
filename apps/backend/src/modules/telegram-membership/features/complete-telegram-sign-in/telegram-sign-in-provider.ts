import { z } from "zod";
import type { TelegramSignInProvider } from "./telegram-account-sign-in.js";
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
    if (!this.secret) return { status: "unavailable" } as const;
    try {
      const response = await fetch(
        `${this.endpoint}/integrations/identity/v1/sign-in/${requestRef}/account-link`,
        {
          method: "POST",
          redirect: "error",
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
        },
      );
      if (!response.ok) return { status: "unavailable" } as const;
      const body: unknown = await response.json();
      const parsed = responseSchema.safeParse(body);
      if (parsed.success)
        return {
          status: "linked",
          telegramIdentityRef: parsed.data.telegramIdentityRef,
        } as const;
      return {
        status: z.object({ status: z.literal("conflict") }).safeParse(body)
          .success
          ? "conflict"
          : "unavailable",
      } as const;
    } catch {
      return { status: "unavailable" } as const;
    }
  }
}
