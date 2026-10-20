import {
  telegramContactsResponseSchema,
  type TelegramContactQuery,
} from "@inside/contracts/telegram-contact";
import { hasText } from "../../../../infrastructure/contracts/text.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { observeTelegramHttp } from "../../../../infrastructure/observability/technical-telemetry.js";
import type { TelegramContactsProvider } from "../../ports/telegram-contacts-provider.js";

const CONTACT_READ_TIMEOUT_MILLISECONDS = 5_000;

/** A read-only optional projection: an older Telegram release can answer 404 without losing submissions. */
export class HttpTelegramContactsProvider implements TelegramContactsProvider {
  constructor(
    private readonly linkingEndpoint: string,
    private readonly secret: string | undefined,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async read(contacts: readonly TelegramContactQuery[]) {
    if (!hasText(this.secret)) return { ok: false } as const;
    return observeTelegramHttp("contacts.read", async (observation) => {
      try {
        const url = new URL("telegram-contacts", this.linkingEndpoint);
        const init = {
          method: "POST",
          redirect: "error" as const,
          signal: AbortSignal.timeout(CONTACT_READ_TIMEOUT_MILLISECONDS),
          headers: {
            authorization: `Bearer ${this.secret}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            contractVersion: "inside.telegram-contact.v1",
            contacts,
          }),
        };
        observation.admit();
        const response = await this.fetcher(url, init);
        observation.response(response.status);
        if (response.status === 404) return { ok: false } as const;
        if (!response.ok)
          return dependencyFailure(
            {
              module: "telegram-membership",
              operation: "readTelegramContacts",
            },
            new Error(
              `Telegram contact provider returned HTTP ${String(response.status)}`,
            ),
            { ok: false } as const,
          );
        const body: unknown = await response.json();
        const parsed = telegramContactsResponseSchema.safeParse(body);
        if (parsed.success) observation.completed();
        return parsed.success
          ? ({ ok: true, contacts: parsed.data.contacts } as const)
          : dependencyFailure(
              {
                module: "telegram-membership",
                operation: "readTelegramContacts",
              },
              parsed.error,
              { ok: false } as const,
            );
      } catch (error) {
        return dependencyFailure(
          { module: "telegram-membership", operation: "readTelegramContacts" },
          error,
          { ok: false } as const,
        );
      }
    });
  }
}
