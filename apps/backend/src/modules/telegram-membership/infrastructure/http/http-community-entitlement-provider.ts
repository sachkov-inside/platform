import {
  COMMUNITY_CONTRACT_VERSION,
  COMMUNITY_MAXIMUM_BODY_BYTES,
  COMMUNITY_REQUEST_TIMEOUT_MS,
  communityErrorSchema,
  communityResultSchema,
  sameAccess,
  type CommunityResult,
  type CommunitySetCommand,
} from "../../domain/community-entitlement.js";
import type {
  CommunityDeliveryOutcome,
  CommunityEntitlementProvider,
} from "../../ports/community-entitlement-provider.js";
import { communityErrorStatus } from "./community-protocol-status.js";

/**
 * Speaks `inside.community-entitlement.v1` to the Telegram provider. It checks both the
 * HTTP status and the body, and correlates every answer with the command it was sent for.
 * An uncorrelated, contradictory or malformed answer is an unknown outcome, never a fact
 * about the Account and never a reason to repeat the external effect.
 */
export class HttpCommunityEntitlementProvider
  implements CommunityEntitlementProvider
{
  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  set(command: CommunitySetCommand): Promise<CommunityDeliveryOutcome> {
    return this.exchange(command, command);
  }

  status(command: CommunitySetCommand): Promise<CommunityDeliveryOutcome> {
    return this.exchange(
      {
        contractVersion: COMMUNITY_CONTRACT_VERSION,
        operation: "entitlement.status",
        operationId: command.operationId,
      },
      command,
    );
  }

  private async exchange(
    body: unknown,
    command: CommunitySetCommand,
  ): Promise<CommunityDeliveryOutcome> {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized) > COMMUNITY_MAXIMUM_BODY_BYTES) {
      return { kind: "unavailable" };
    }
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        body: serialized,
        headers: {
          authorization: `Bearer ${this.secret}`,
          "content-type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(COMMUNITY_REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { kind: "unavailable" };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      return { kind: "unavailable" };
    }
    if (response.status === 200) {
      const result = communityResultSchema.safeParse(payload);
      return result.success && correlates(result.data, command)
        ? { kind: "result", result: result.data }
        : { kind: "unavailable" };
    }
    const failure = communityErrorSchema.safeParse(payload);
    // A status that contradicts its own body is an unknown outcome, not a decision.
    return failure.success &&
      failure.data.operationId === command.operationId &&
      communityErrorStatus[failure.data.error] === response.status
      ? { kind: "error", error: failure.data.error }
      : { kind: "unavailable" };
  }
}

/**
 * A result must echo the command it answers, not an arbitrary later snapshot of the
 * Account: same operation, same recipient, same revision and same access.
 */
function correlates(
  result: CommunityResult,
  command: CommunitySetCommand,
): boolean {
  return (
    result.operationId === command.operationId &&
    result.entitlementRevision === command.entitlementRevision &&
    result.binding.accountRef === command.binding.accountRef &&
    result.binding.telegramIdentityRef ===
      command.binding.telegramIdentityRef &&
    result.binding.linkRef === command.binding.linkRef &&
    result.binding.linkRevision === command.binding.linkRevision &&
    sameAccess(result.access, command.access)
  );
}
