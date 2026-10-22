import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import {
  readIdentityEmailSchema,
  type IdentityEmail,
  type StartIdentityEmail,
} from "@/shared/auth/identity-account-contract";

import {
  confirmAccountEmailOperation,
  startAccountEmailOperation,
} from "./account-email.operation";

export async function readAccountEmail(): Promise<IdentityEmail> {
  const result = await requestAuthenticatedRead("/api/account/email");
  if (result.kind !== "ready")
    return {
      ok: false,
      code:
        result.kind === "authentication_required"
          ? "unauthorized"
          : "unavailable",
    };
  const parsed = readIdentityEmailSchema.safeParse(result.value);
  return parsed.success ? parsed.data : { ok: false, code: "unavailable" };
}
export function startAccountEmail(email: string): Promise<StartIdentityEmail> {
  return startAccountEmailOperation.send({ email });
}
export const confirmAccountEmail = confirmAccountEmailOperation.send;
