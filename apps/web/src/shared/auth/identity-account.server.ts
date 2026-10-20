import "server-only";

import { getAccessToken } from "@logto/next/server-actions";
import { createIdentityAccountClient } from "./identity-account-client.server";
import { readLogtoBffConfig } from "./logto-bff-config.server";

/** Opaque OIDC token belongs only to the identity provider, never to the Platform API or browser. */
export async function identityAccount() {
  const config = readLogtoBffConfig();
  return createIdentityAccountClient(
    config.endpoint,
    await getAccessToken(config),
  );
}
