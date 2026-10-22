import { z } from "zod";

import {
  defineMutationOperation,
  type MutationTransportFailure,
} from "@/shared/api/mutation-operation";
import {
  confirmIdentityEmailSchema,
  startIdentityEmailSchema,
} from "@/shared/auth/identity-account-contract";

function emailTransportFailure(failure: MutationTransportFailure) {
  return {
    ok: false,
    code:
      failure.kind === "status" && failure.status === 401
        ? "unauthorized"
        : "unavailable",
  } as const;
}

/** Sends a confirmation code to the email the Account wants to sign in with. */
export const startAccountEmailOperation = defineMutationOperation({
  input: z.object({ email: z.email().max(128) }),
  method: "POST",
  path: "/api/account/email/start",
  result: startIdentityEmailSchema,
  transportFailure: emailTransportFailure,
});

/** Confirms the sign-in email with the code it received. */
export const confirmAccountEmailOperation = defineMutationOperation({
  input: z.object({
    challengeRef: z.string().min(1).max(128),
    code: z.string().regex(/^[0-9]{6}$/u),
  }),
  method: "POST",
  path: "/api/account/email/confirm",
  result: confirmIdentityEmailSchema,
  transportFailure: emailTransportFailure,
});
