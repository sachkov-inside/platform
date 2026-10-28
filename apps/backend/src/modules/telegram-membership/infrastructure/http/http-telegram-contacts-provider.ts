import {
  telegramContactsResponseSchema,
  type TelegramContactQuery,
} from "@inside/contracts/telegram-contact";
import {
  normalizeTelegramContactSearchQuery,
  telegramContactSearchResponseSchema,
  telegramContactsV2ResponseSchema,
} from "@inside/contracts/telegram-contact-v2";
import { hasText } from "../../../../infrastructure/contracts/text.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import { observeTelegramHttp } from "../../../../infrastructure/observability/technical-telemetry.js";
import type { TelegramContactsProvider } from "../../ports/telegram-contacts-provider.js";

const CONTACT_READ_TIMEOUT_MILLISECONDS = 5_000;
/** Search answers an interactive author query; a slow provider shows «временно недоступен». */
const CONTACT_SEARCH_TIMEOUT_MILLISECONDS = 3_000;

const unavailable = { ok: false, reason: "unavailable" } as const;
const notSupported = { ok: false, reason: "not_supported" } as const;

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

  async readWithMarketing(contacts: readonly TelegramContactQuery[]) {
    const scope = {
      module: "telegram-membership",
      operation: "readTelegramContactsV2",
    };
    const answer = await this.post(
      "../v2/telegram-contacts/read",
      { contractVersion: "inside.telegram-contact.v2", contacts },
      CONTACT_READ_TIMEOUT_MILLISECONDS,
      scope,
    );
    if (!answer.ok) return answer.notFound ? notSupported : unavailable;
    const parsed = telegramContactsV2ResponseSchema.safeParse(answer.body);
    // The answer is aligned with the request: same pairs in the same order.
    return parsed.success &&
      parsed.data.contacts.length === contacts.length &&
      parsed.data.contacts.every(
        (contact, index) =>
          contact.accountRef === contacts[index]?.accountRef &&
          contact.telegramIdentityRef === contacts[index].telegramIdentityRef,
      )
      ? ({ ok: true, contacts: parsed.data.contacts } as const)
      : dependencyFailure(
          scope,
          parsed.success
            ? new Error("Telegram contact answer does not match the request")
            : parsed.error,
          unavailable,
        );
  }

  /** The search text is personal data: it is sent to Telegram and never logged. */
  async search(query: string, limit: number) {
    const scope = {
      module: "telegram-membership",
      operation: "searchTelegramContacts",
    };
    const normalized = normalizeTelegramContactSearchQuery(query);
    if (normalized === undefined) return unavailable;
    const answer = await this.post(
      "../v2/telegram-contacts/search",
      {
        contractVersion: "inside.telegram-contact.v2",
        query: normalized,
        limit,
      },
      CONTACT_SEARCH_TIMEOUT_MILLISECONDS,
      scope,
    );
    if (!answer.ok) return answer.notFound ? notSupported : unavailable;
    const parsed = telegramContactSearchResponseSchema.safeParse(answer.body);
    return parsed.success && parsed.data.matches.length <= limit
      ? ({
          ok: true,
          matches: parsed.data.matches,
          truncated: parsed.data.truncated,
        } as const)
      : dependencyFailure(
          scope,
          parsed.success
            ? new Error("Telegram contact search exceeded the requested limit")
            : parsed.error,
          unavailable,
        );
  }

  /** Paths resolve against the linking endpoint `…/integrations/platform/v1/identity-links`. */
  private async post(
    path: string,
    body: unknown,
    timeoutMilliseconds: number,
    scope: { readonly module: string; readonly operation: string },
  ): Promise<
    | { readonly ok: true; readonly body: unknown }
    | { readonly ok: false; readonly notFound: boolean }
  > {
    if (!hasText(this.secret)) return { ok: false, notFound: false };
    try {
      const response = await this.fetcher(new URL(path, this.linkingEndpoint), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMilliseconds),
        headers: {
          authorization: `Bearer ${this.secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (response.status === 404) return { ok: false, notFound: true };
      if (!response.ok)
        return dependencyFailure(
          scope,
          new Error(
            `Telegram contact provider returned HTTP ${String(response.status)}`,
          ),
          { ok: false, notFound: false } as const,
        );
      const answer: unknown = await response.json();
      return { ok: true, body: answer };
    } catch (error) {
      return dependencyFailure(scope, error, {
        ok: false,
        notFound: false,
      } as const);
    }
  }
}
