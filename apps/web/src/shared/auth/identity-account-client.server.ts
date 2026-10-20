import "server-only";

import { z } from "zod";

import type { emailAttachmentFailureSchema } from "./identity-account-contract";
type Failure = z.infer<typeof emailAttachmentFailureSchema>;
const startSchema = z.object({
  verificationRecordId: z.string().min(1).max(128),
  expiresAt: z.iso.datetime(),
});
const userInfoSchema = z.object({
  sub: z.string().min(1),
  email: z.email().optional(),
});
const providerErrorSchema = z.object({ code: z.string() });

/** Fixed, user-scoped Logto operations. Never accepts a user ID or a browser-selected provider URL. */
export function createIdentityAccountClient(
  endpoint: string,
  accessToken: string,
  request: typeof fetch = fetch,
) {
  async function call(
    path: string,
    body?: unknown,
  ): Promise<Response | Failure> {
    try {
      return await request(new URL(path, endpoint).href, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      return { ok: false, code: "unavailable" };
    }
  }
  async function failure(response: Response): Promise<Failure> {
    if (response.status === 429) return { ok: false, code: "rate_limited" };
    if (response.status === 401) return { ok: false, code: "unauthorized" };
    try {
      const error = providerErrorSchema.safeParse(await response.json());
      if (error.success) {
        if (error.data.code === "user.email_already_in_use")
          return { ok: false, code: "email_conflict" };
        if (
          error.data.code.startsWith("verification_code.") ||
          error.data.code.startsWith("verification_record.")
        )
          return { ok: false, code: "challenge_invalid" };
      }
    } catch {
      /* A provider error need not have a JSON body. */
    }
    return { ok: false, code: "unavailable" };
  }
  return {
    async read(): Promise<
      { readonly ok: true; readonly email: string | null } | Failure
    > {
      const response = await call("/oidc/me");
      if (!(response instanceof Response)) return response;
      if (!response.ok) return failure(response);
      try {
        const data = userInfoSchema.parse(await response.json());
        return { ok: true, email: data.email ?? null };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
    async startEmail(
      email: string,
    ): Promise<{ readonly ok: true; readonly challengeRef: string } | Failure> {
      const address = z.email().max(254).safeParse(email.trim().toLowerCase());
      if (!address.success) return { ok: false, code: "invalid_input" };
      const response = await call("/api/my-account/first-email/start", {
        email: address.data,
      });
      if (!(response instanceof Response)) return response;
      if (!response.ok) return failure(response);
      try {
        return {
          ok: true,
          challengeRef: startSchema.parse(await response.json())
            .verificationRecordId,
        };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
    async confirmEmail(input: {
      readonly challengeRef: string;
      readonly code: string;
    }): Promise<{ readonly ok: true } | Failure> {
      if (
        !z.string().min(1).max(128).safeParse(input.challengeRef).success ||
        !/^[0-9]{6}$/u.test(input.code)
      )
        return { ok: false, code: "invalid_input" };
      const response = await call("/api/my-account/first-email/confirm", {
        verificationRecordId: input.challengeRef,
        code: input.code,
      });
      if (!(response instanceof Response)) return response;
      return response.status === 204 ? { ok: true } : failure(response);
    },
  };
}
