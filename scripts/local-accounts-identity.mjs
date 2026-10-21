// @ts-check
import { wrapSession } from "@logto/node";
import { z } from "zod";
import { tokenCache } from "./authoring-stand-gateway.mjs";
import { validateLocalAccountsSettings } from "./local-accounts-gateway.mjs";
const standTokenExchangeTimeoutMs = 10_000;
const maxStandAccessTokenLifetimeSeconds = 300;

export const localAccountsConfigSchema = z.object({
  endpoint: z.string(),
  audience: z.string(),
  webBaseUrl: z.string(),
  appId: z.string().min(1),
  cookieSecret: z.string().min(32),
  exchangeAppId: z.string().min(1),
  exchangeAppSecret: z.string().min(1),
  profiles: z.object({
    owner: z.object({ pat: z.string().min(1) }),
    learner: z.object({ pat: z.string().min(1) }),
    "learner-with-access": z.object({ pat: z.string().min(1) }),
  }),
});
/** @param {z.infer<typeof localAccountsConfigSchema>} config @param {string} pat */
export async function exchangeStandToken(config, pat) {
  const response = await fetch(`${config.endpoint}/oidc/token`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(standTokenExchangeTimeoutMs),
    headers: {
      authorization: `Basic ${Buffer.from(`${config.exchangeAppId}:${config.exchangeAppSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: pat,
      subject_token_type: "urn:logto:token-type:personal_access_token",
      resource: config.audience,
    }),
  });
  if (!response.ok)
    throw new Error(`Local stand token exchange refused (${response.status})`);
  return z
    .object({
      access_token: z.string().min(1),
      expires_in: z
        .number()
        .int()
        .positive()
        .max(maxStandAccessTokenLifetimeSeconds),
    })
    .parse(await response.json());
}
/** @param {unknown} input @param {string | undefined} mode */
export function createLocalAccountsIdentity(input, mode) {
  const config = localAccountsConfigSchema.parse(input);
  validateLocalAccountsSettings({ ...config, mode });
  const tokens = new Map(
    Object.entries(config.profiles).map(([choice, profile]) => [
      choice,
      tokenCache(() => exchangeStandToken(config, profile.pat)),
    ]),
  );
  return {
    config,
    cookieName: `logto_${config.appId}`,
    /** @param {string} choice */
    async accessToken(choice) {
      const read = tokens.get(choice);
      if (read === undefined) throw new Error("Unknown local profile");
      return read();
    },
    /** @param {string} choice */
    async createSession(choice) {
      const read = tokens.get(choice);
      if (read === undefined) throw new Error("Unknown local profile");
      const token = await read();
      // The cache renews before expiry. Decode only the time for the SDK; the API verifies JWTs.
      const payload = z
        .object({ exp: z.number().int() })
        .parse(
          JSON.parse(
            Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
          ),
        );
      return wrapSession(
        {
          // As in the editor fixture, SDK storage needs a nonempty identity marker. The local
          // adapter keeps the exchanged JWT here for subject display; it never treats it as an
          // OIDC authentication proof. Only the API's verified bearer token authorizes a call.
          idToken: token,
          accessToken: JSON.stringify({
            [`@${config.audience}`]: {
              token,
              scope: "",
              expiresAt: payload.exp,
            },
          }),
        },
        config.cookieSecret,
      );
    },
  };
}
