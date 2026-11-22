import "server-only";

import LogtoClient from "@logto/next/server-actions";
import { createIdentityAccountClient } from "./identity-account-client.server";
import { readLogtoBffConfig } from "./logto-bff-config.server";

/** Opaque OIDC token belongs only to the identity provider, never to the Platform API or browser. */
export async function identityAccount() {
  const config = readLogtoBffConfig();
  const client = await new LogtoClient(config).createNodeClient();
  // The SDK stores the audience-bound token from sign-in in its default slot.
  // Give the opaque token its own SDK cache key while keeping the refresh grant resource-free.
  const accountTokenKey = new URL("/oidc/me", config.endpoint).href;
  const request = client.adapter.requester;
  client.adapter.requester = (input, init) =>
    request(input, omitAccountTokenResource(init, accountTokenKey));
  return createIdentityAccountClient(
    config.endpoint,
    await client.getAccessToken(accountTokenKey),
  );
}

function omitAccountTokenResource(
  init: RequestInit | undefined,
  accountTokenKey: string,
): RequestInit | undefined {
  if (typeof init?.body !== "string") return init;
  const body = new URLSearchParams(init.body);
  if (
    body.get("grant_type") !== "refresh_token" ||
    body.get("resource") !== accountTokenKey
  ) {
    return init;
  }
  body.delete("resource");
  return { ...init, body: body.toString() };
}
