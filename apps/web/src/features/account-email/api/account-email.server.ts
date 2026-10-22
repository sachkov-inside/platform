import "server-only";

import {
  handleMutationOperation,
  handleAuthenticatedRead,
} from "@/shared/auth/index.server";
import { identityAccount } from "@/shared/auth/identity-account.server";

import {
  confirmAccountEmailOperation,
  startAccountEmailOperation,
} from "./account-email.operation";

export function handleReadAccountEmail(): Promise<Response> {
  return handleAuthenticatedRead(async () => {
    const account = await identityAccount();
    return Response.json(await account.read());
  });
}
export function handleStartAccountEmail(request: Request): Promise<Response> {
  return handleMutationOperation(request, startAccountEmailOperation, {
    invalidInput: () => ({ ok: false, code: "invalid_input" }) as const,
    execute: async (input) => {
      try {
        return await (await identityAccount()).startEmail(input.email);
      } catch {
        return { ok: false, code: "unavailable" } as const;
      }
    },
  });
}
export function handleConfirmAccountEmail(request: Request): Promise<Response> {
  return handleMutationOperation(request, confirmAccountEmailOperation, {
    invalidInput: () => ({ ok: false, code: "invalid_input" }) as const,
    execute: async (input) => {
      try {
        return await (await identityAccount()).confirmEmail(input);
      } catch {
        return { ok: false, code: "unavailable" } as const;
      }
    },
  });
}
