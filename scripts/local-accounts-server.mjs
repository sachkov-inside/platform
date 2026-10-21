// @ts-check
// This entrypoint exists only in the development workspace image, never a release runtime.
import { readFile } from "node:fs/promises";
import { createLocalAccountsIdentity } from "./local-accounts-identity.mjs";
import { startLocalAccountsGateway } from "./local-accounts-gateway.mjs";
import { z } from "zod";
const developmentEnvironmentRequestTimeoutMs = 10_000;

const identity = createLocalAccountsIdentity(
  JSON.parse(await readFile("/local-accounts/local-accounts.json", "utf8")),
  process.env["NODE_ENV"],
);
const response = await fetch(
  "http://api:3001/authoring/import/materials/environment",
  {
    redirect: "error",
    signal: AbortSignal.timeout(developmentEnvironmentRequestTimeoutMs),
    headers: { authorization: `Bearer ${await identity.accessToken("owner")}` },
  },
);
if (
  !response.ok ||
  z.object({ mode: z.string() }).parse(await response.json()).mode !==
    "development"
)
  throw new Error("Local account gateway requires a verified development API");
const gateway = await startLocalAccountsGateway({
  port: Number(new URL(identity.config.webBaseUrl).port || 80),
  listenHost: "0.0.0.0",
  upstream: "http://web:3000",
  secret: identity.config.cookieSecret,
  cookieName: identity.cookieName,
  createSession: identity.createSession,
});
process.stdout.write(
  `Local accounts: ${gateway.origin} (owner / learners / guest)\n`,
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void gateway.close().then(() => process.exit(0));
  });
