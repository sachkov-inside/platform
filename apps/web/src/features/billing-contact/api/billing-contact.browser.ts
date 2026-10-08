import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  readContactSchema,
  startContactResultSchema,
  confirmContactResultSchema,
  type StartContactInput,
  type ConfirmContactInput,
  type StartContactResult,
  type ConfirmContactResult,
  type ReadContactResult,
} from "../model/billing-contact";

/** Собственный контакт Account: закрытый исход вместо строки в тексте ошибки. */
export async function readBillingContact(): Promise<ReadContactResult> {
  const result = await requestAuthenticatedRead("/api/account/billing/contact");
  if (result.kind !== "ready")
    return {
      ok: false,
      code:
        result.kind === "authentication_required"
          ? "unauthorized"
          : "unavailable",
    };
  try {
    const parsed = readContactSchema.safeParse(result.value);
    return parsed.success ? parsed.data : { ok: false, code: "unavailable" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}
export async function startBillingContact(
  input: StartContactInput,
): Promise<StartContactResult> {
  const form = new FormData();
  form.set("operationId", input.operationId);
  form.set("email", input.email);
  form.set("expectedRevision", String(input.expectedRevision));
  const response = await requestSameOriginMutation(
    "/api/account/billing/contact/start",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      ok: false,
      code: response.status === 401 ? "unauthorized" : "unavailable",
    };
  const parsed = startContactResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { ok: false, code: "unavailable" };
}
export async function confirmBillingContact(
  input: ConfirmContactInput,
): Promise<ConfirmContactResult> {
  const form = new FormData();
  form.set("operationId", input.operationId);
  form.set("challengeRef", input.challengeRef);
  form.set("code", input.code);
  const response = await requestSameOriginMutation(
    "/api/account/billing/contact/confirm",
    "POST",
    form,
  );
  if (!response.ok)
    return {
      ok: false,
      code: response.status === 401 ? "unauthorized" : "unavailable",
    };
  const parsed = confirmContactResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { ok: false, code: "unavailable" };
}
