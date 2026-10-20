import "server-only";

import { z } from "zod";
import {
  handleAuthenticatedMutation,
  handleAuthenticatedRead,
} from "@/shared/auth/index.server";
import { identityAccount } from "@/shared/auth/identity-account.server";

export function handleReadAccountEmail(): Promise<Response> {
  return handleAuthenticatedRead(async () => {
    const account = await identityAccount();
    return Response.json(await account.read());
  });
}
export function handleStartAccountEmail(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (form) => {
    const email = z.email().max(128).safeParse(form.get("email"));
    if (!email.success) return { ok: false, code: "invalid_input" };
    try {
      return await (await identityAccount()).startEmail(email.data);
    } catch {
      return { ok: false, code: "unavailable" };
    }
  });
}
export function handleConfirmAccountEmail(request: Request): Promise<Response> {
  return handleAuthenticatedMutation(request, async (form) => {
    const input = z
      .object({
        challengeRef: z.string().min(1).max(128),
        code: z.string().regex(/^[0-9]{6}$/u),
      })
      .safeParse({
        challengeRef: form.get("challengeRef"),
        code: form.get("code"),
      });
    if (!input.success) return { ok: false, code: "invalid_input" };
    try {
      return await (await identityAccount()).confirmEmail(input.data);
    } catch {
      return { ok: false, code: "unavailable" };
    }
  });
}
