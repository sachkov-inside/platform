import { requestAuthenticatedRead } from "@/shared/api/authenticated-read.browser";
import {
  readContactSchema,
  type ReadContactResult,
} from "../model/billing-contact";

import {
  confirmBillingContactOperation,
  startBillingContactOperation,
} from "./billing-contact.operation";

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
export const startBillingContact = startBillingContactOperation.send;
export const confirmBillingContact = confirmBillingContactOperation.send;
