import { z } from "zod";

import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import {
  observeTelegramHttp,
  type TelegramHttpObservation,
} from "../../../../infrastructure/observability/technical-telemetry.js";
import type {
  ConfirmTelegramLinkRequest,
  RegisterTelegramLinkRequest,
  TelegramLinkProvider,
  TelegramLinkProviderConfirmation,
  TelegramLinkProviderRegistration,
} from "../../ports/telegram-link-provider.js";

const CONTRACT_VERSION = "inside.identity-linking.v1";
const REQUEST_TIMEOUT_MS = 5_000;
const opaqueRefSchema = z.string().min(1).max(256);
const registrationSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    expiresAt: z.iso.datetime({ offset: true }),
    linkTransactionRef: opaqueRefSchema,
    returnCorrelation: opaqueRefSchema,
    status: z.literal("pending"),
  })
  .strict();
const linkedSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    linkTransactionRef: opaqueRefSchema,
    returnCorrelation: opaqueRefSchema,
    status: z.enum(["idempotent", "linked"]),
    telegramIdentityRef: opaqueRefSchema,
  })
  .strict();
const pendingConfirmationSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    linkTransactionRef: opaqueRefSchema,
    returnCorrelation: opaqueRefSchema,
    status: z.enum([
      "conflict",
      "expired",
      "pending",
      "recovery-required",
      "replayed",
    ]),
  })
  .strict();

export class HttpTelegramLinkProvider implements TelegramLinkProvider {
  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async register(
    request: RegisterTelegramLinkRequest,
  ): Promise<TelegramLinkProviderRegistration> {
    return observeTelegramHttp("link.register", async (observation) => {
      const response = await this.post(
        this.endpoint,
        {
          accountRef: request.accountRef,
          contractVersion: CONTRACT_VERSION,
          expiresAt: request.expiresAt.toISOString(),
          returnCorrelation: request.returnCorrelation,
          tokenDigest: request.tokenDigest,
        },
        observation,
      );
      if (response === undefined) {
        return { kind: "unavailable" };
      }
      const parsed = registrationSchema.safeParse(response);
      if (parsed.success) observation.completed();
      return parsed.success
        ? {
            expiresAt: new Date(parsed.data.expiresAt),
            kind: "registered",
            linkTransactionRef: parsed.data.linkTransactionRef,
            returnCorrelation: parsed.data.returnCorrelation,
          }
        : { kind: "recovery_required" };
    });
  }

  async confirm(
    request: ConfirmTelegramLinkRequest,
  ): Promise<TelegramLinkProviderConfirmation> {
    return observeTelegramHttp("link.confirm", async (observation) => {
      const response = await this.post(
        `${this.endpoint}/${encodeURIComponent(request.linkTransactionRef)}/confirm`,
        {
          accountRef: request.accountRef,
          contractVersion: CONTRACT_VERSION,
          returnCorrelation: request.returnCorrelation,
        },
        observation,
      );
      if (response === undefined) {
        return { kind: "unavailable" };
      }
      const linked = linkedSchema.safeParse(response);
      if (linked.success) {
        observation.completed();
        return {
          kind: "linked",
          linkTransactionRef: linked.data.linkTransactionRef,
          returnCorrelation: linked.data.returnCorrelation,
          telegramIdentityRef: linked.data.telegramIdentityRef,
        };
      }
      const pending = pendingConfirmationSchema.safeParse(response);
      if (pending.success) {
        observation.completed();
        return {
          kind:
            pending.data.status === "recovery-required"
              ? "recovery_required"
              : pending.data.status,
        };
      }
      return { kind: "recovery_required" };
    });
  }

  private async post(
    url: string,
    body: Readonly<Record<string, unknown>>,
    observation: TelegramHttpObservation,
  ): Promise<unknown> {
    try {
      const init = {
        body: JSON.stringify(body),
        headers: {
          authorization: `Bearer ${this.secret}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      };
      observation.admit();
      const response = await this.fetcher(url, init);
      observation.response(response.status);
      if (!response.ok) {
        return undefined;
      }
      return await response.json();
    } catch (error) {
      return dependencyFailure(
        { module: "telegram-membership", operation: "post" },
        error,
        undefined,
      );
    }
  }
}
