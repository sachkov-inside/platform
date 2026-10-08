import { readBoundedJson } from "./read-bounded-json.js";
import {
  validBindingResponse,
  type BindingResponse,
  ACTIVATION_VERSION,
  validActivationResponse,
  validOwnAccessResponse,
  validInvitationRedeemResponse,
  type ActivationBegin,
  type ActivationBinding,
  type ActivationEvidence,
  type ActivationResponse,
  type ActivationResult,
  type InvitationRedeem,
  type InvitationRedeemResponse,
  type OwnAccess,
} from "../../modules/subscription-activation/activation-contract.js";
import type { ActivationPlatform } from "../../modules/subscription-activation/activation-ports.js";
import type { ValidateFunction } from "ajv";
import { reportFailure } from "../../shared/failure-diagnostics.js";

/** Only the source-authority secret crosses this boundary; redirects are forbidden. */
export class HttpActivationPlatform implements ActivationPlatform {
  constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}
  binding(identityRef: string): Promise<BindingResponse | undefined> {
    return this.post(
      "binding",
      { contractVersion: ACTIVATION_VERSION, identityRef },
      validBindingResponse,
    );
  }
  begin(
    input: ActivationBegin,
  ): Promise<ActivationResult<ActivationResponse> | undefined> {
    return this.post("attempts", input, validActivationResponse);
  }
  evidence(
    input: ActivationEvidence,
  ): Promise<ActivationResult<ActivationResponse> | undefined> {
    // PostgreSQL jsonb reorders keys. Keep the same wire bytes on initial send
    // and durable replay without changing any evidence values or references.
    const entries: [string, unknown][] = Object.entries(input);
    const ordered = Object.fromEntries(
      entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    return this.post("evidence", ordered, validActivationResponse);
  }
  own(
    binding: ActivationBinding,
  ): Promise<ActivationResult<OwnAccess> | undefined> {
    return this.post(
      "own-access",
      { contractVersion: ACTIVATION_VERSION, ...binding },
      validOwnAccessResponse,
    );
  }
  /** A sibling of the activation operations: `<base>/subscription-activation` → `<base>/invitations/redeem`. */
  redeem(
    input: InvitationRedeem,
  ): Promise<InvitationRedeemResponse | undefined> {
    return this.post(
      "../invitations/redeem",
      input,
      validInvitationRedeemResponse,
    );
  }
  private async post<T>(
    path: string,
    input: unknown,
    validate: ValidateFunction<T>,
  ): Promise<T | undefined> {
    try {
      const signal = AbortSignal.timeout(5000);
      const response = await this.fetcher(
        new URL(path, `${this.endpoint}/`).href,
        {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal,
          headers: {
            authorization: `Bearer ${this.secret}`,
            "content-type": "application/json",
            "x-inside-domain-names": "products.v1",
          },
          body: JSON.stringify(input),
        },
      );
      if (response.status !== 200) return;
      const body = await readBoundedJson(response, 1_048_576, signal);
      return validate(body) ? body : undefined;
    } catch (error) {
      reportFailure("platform.activation", error);
      return;
    }
  }
}
