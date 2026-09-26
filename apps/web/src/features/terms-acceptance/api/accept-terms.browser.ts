import { requestSameOriginMutation } from "@/shared/api/same-origin-mutation";

import {
  acceptTermsResultSchema,
  type AcceptTermsInput,
  type AcceptTermsResult,
} from "../model/terms-acceptance";

export async function acceptTerms(
  input: AcceptTermsInput,
): Promise<AcceptTermsResult> {
  const form = new FormData();
  form.set("input", JSON.stringify(input));
  const response = await requestSameOriginMutation(
    "/api/account/terms",
    "POST",
    form,
  );
  if (!response.ok)
    return response.status === 401
      ? { kind: "unauthorized" }
      : { kind: "unavailable" };
  const parsed = acceptTermsResultSchema.safeParse(response.body);
  return parsed.success ? parsed.data : { kind: "unavailable" };
}
