import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  readIdentityEmailSchema,
  startIdentityEmailSchema,
  confirmIdentityEmailSchema,
  type IdentityEmail,
  type StartIdentityEmail,
  type ConfirmIdentityEmail,
} from "@/shared/auth/identity-account-contract";

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
export async function startAccountEmail(
  email: string,
): Promise<StartIdentityEmail> {
  const form = new FormData();
  form.set("email", email);
  const response = await requestSameOriginMutation(
    "/api/account/email/start",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      ok: false,
      code: response.status === 401 ? "unauthorized" : "unavailable",
    };
  const parsed = startIdentityEmailSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { ok: false, code: "unavailable" };
}
export async function confirmAccountEmail(input: {
  readonly challengeRef: string;
  readonly code: string;
}): Promise<ConfirmIdentityEmail> {
  const form = new FormData();
  form.set("challengeRef", input.challengeRef);
  form.set("code", input.code);
  const response = await requestSameOriginMutation(
    "/api/account/email/confirm",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      ok: false,
      code: response.status === 401 ? "unauthorized" : "unavailable",
    };
  const parsed = confirmIdentityEmailSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { ok: false, code: "unavailable" };
}
