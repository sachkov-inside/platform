import { randomUUID } from "node:crypto";

import type { DeclaredServer } from "./declared-api.js";

/**
 * Passes the first sign-in screen for an established Account: the cabinet, purchases and the bot
 * link answer only after the terms of use in force are accepted by the button.
 */
export async function acceptCurrentTerms(
  server: DeclaredServer,
  headers: Readonly<Record<string, string>>,
): Promise<void> {
  const status = await server.inject({
    method: "GET",
    url: "/accounts/current/legal-acceptances/terms",
    headers,
  });
  if (status.statusCode !== 200)
    throw new Error(`Terms status answered ${String(status.statusCode)}`);
  const { document } = status.json<{
    readonly document: { readonly version: string; readonly digest: string };
  }>();
  const accepted = await server.inject({
    method: "POST",
    url: "/accounts/current/legal-acceptances/terms",
    headers,
    payload: {
      operationId: randomUUID(),
      version: document.version,
      digest: document.digest,
      buttonLabel: "Принять условия и продолжить",
    },
  });
  if (accepted.statusCode !== 200)
    throw new Error(`Terms acceptance answered ${String(accepted.statusCode)}`);
}
