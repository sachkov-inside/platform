// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import LogtoClient, { unwrapSession } from "@logto/node";
import { createLocalAccountsIdentity } from "./local-accounts-identity.mjs";

test("local PAT session is accepted by the real Logto SDK without changing API bearer tokens", async (t) => {
  const now = new Date("2030-01-01T00:00:00Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  const token = `header.${Buffer.from(JSON.stringify({ exp: now.getTime() / 1000 + 300, sub: "local-owner" })).toString("base64url")}.signature`;
  t.mock.method(globalThis, "fetch", () =>
    Promise.resolve(Response.json({ access_token: token, expires_in: 300 })),
  );
  const config = {
    endpoint: "https://identity.inside.localhost:3301",
    audience: "http://127.0.0.1:3001",
    webBaseUrl: "http://127.0.0.1:3000",
    appId: "local-web",
    cookieSecret: "local-sdk-contract-secret-at-least-32-characters",
    exchangeAppId: "local-exchange",
    exchangeAppSecret: "synthetic-secret",
    profiles: {
      owner: { pat: "owner-pat" },
      learner: { pat: "learner-pat" },
      "learner-with-access": { pat: "access-pat" },
    },
  };
  assert.throws(() => createLocalAccountsIdentity(config, "production"));
  const identity = createLocalAccountsIdentity(config, "development");
  const saved = await unwrapSession(
    await identity.createSession("owner"),
    config.cookieSecret,
  );
  const storage = new Map(Object.entries(saved));
  const client = new LogtoClient(
    {
      endpoint: config.endpoint,
      appId: config.appId,
      resources: [config.audience],
    },
    {
      navigate: () => {
        throw new Error("No interactive sign-in in the local stand");
      },
      storage: {
        getItem: (key) => Promise.resolve(storage.get(key) ?? null),
        setItem: (key, value) => {
          storage.set(key, value);
          return Promise.resolve();
        },
        removeItem: (key) => {
          storage.delete(key);
          return Promise.resolve();
        },
      },
    },
  );
  assert.equal(await client.getAccessToken(config.audience), token);
});
