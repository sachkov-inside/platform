import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";
import {
  readContactSchema,
  startContactResultSchema,
  confirmContactResultSchema,
  type StartContactInput,
  type ConfirmContactInput,
  type StartContactResult,
  type ConfirmContactResult,
} from "../model/billing-contact";

export async function readBillingContact() {
  const response = await fetch("/api/account/billing/contact", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok)
    throw new Error(response.status === 401 ? "unauthorized" : "unavailable");
  return readContactSchema.parse(await response.json());
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
