// @ts-check
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startFullStackIdentity } from "./full-stack-identity.mjs";
import {
  assertLightDatabase,
  lightEnvironment,
  lightInstanceName,
  lightRoleNames,
  lightRoles,
  lightSignInHandler,
  seedLightRoles,
  listLightStates,
  treeResidentKiB,
} from "./stand-light-plan.mjs";

test("each worktree gets its own database and session cookie name", () => {
  const first = lightInstanceName("/work/a");
  const second = lightInstanceName("/work/b");
  assert.match(first.database, /^inside_light_[0-9a-f]{10}$/u);
  assert.notEqual(first.database, second.database);
  assert.notEqual(first.appId, second.appId);
  assert.deepEqual(lightInstanceName("/work/a"), first);
});

test("only a light instance database can be named for teardown", () => {
  for (const name of [
    "inside",
    "inside_checks",
    "inside_light_",
    "inside_light_0123456789; drop",
  ])
    assert.throws(
      () => assertLightDatabase(name),
      /not a light instance database/u,
    );
  assert.equal(
    assertLightDatabase("inside_light_0123456789"),
    "inside_light_0123456789",
  );
});

test("the instance environment names its own database and ports and drops the caller's sign-in", () => {
  const { shared, mcp, urls, web } = lightEnvironment({
    database: "inside_light_0123456789",
    postgresPort: 5432,
    ports: {
      web: 21000,
      api: 21001,
      mcp: undefined,
      bank: 21002,
      telegram: 21003,
    },
    identity: { LOGTO_APP_ID: "inside-web-light-0123456789" },
    defaults: { IDENTITY_EMAIL_FINGERPRINT_KEY: "example", PATH: "/example" },
    base: {
      PATH: "/bin",
      TBANK_CONFIG_JSON: "must-never-be-used",
      TBANK_CA_FILE: "/real/certificate",
      TELEGRAM_LINKING_ENDPOINT: "https://must-never-be-used.invalid",
      DATABASE_URL: "postgresql://inside:inside@127.0.0.1:5432/inside",
      COMPOSE_PROJECT_NAME: "inside-platform",
      LOGTO_ENDPOINT: "https://identity.inside.localhost:3301",
      OBJECT_STORAGE_SIGNED_GET_ENDPOINT: "http://127.0.0.1:29000",
    },
    webMode: "production",
  });
  assert.equal(
    shared["DATABASE_URL"],
    "postgresql://inside:inside@127.0.0.1:5432/inside_light_0123456789",
  );
  assert.equal(shared["API_PORT"], "21001");
  assert.equal(shared["TBANK_PROVIDER_MODE"], "test");
  assert.equal(shared["TBANK_CONFIG_JSON"], undefined);
  assert.equal(shared["TBANK_CA_FILE"], undefined);
  assert.equal(shared["TBANK_TEST_API_BASE_URL"], "http://127.0.0.1:21002/v2");
  assert.equal(shared["TBANK_TEST_PUBLIC_ORIGIN"], "http://127.0.0.1:21002");
  assert.equal(
    shared["TBANK_TEST_NOTIFICATION_URL"],
    "http://127.0.0.1:21001/billing/tbank/notification",
  );
  assert.equal(
    shared["TBANK_TEST_RETURN_URL"],
    "http://127.0.0.1:21000/payment/return",
  );
  assert.equal(
    shared["TELEGRAM_LINKING_ENDPOINT"],
    "http://127.0.0.1:21003/integrations/platform/v1/identity-links",
  );

  assert.equal(shared["BACKEND_BASE_URL"], "http://127.0.0.1:21001");
  assert.equal(shared["PUBLIC_SITE_ORIGIN"], "http://127.0.0.1:21000");
  assert.equal(shared["LOGTO_ENDPOINT"], undefined);
  assert.equal(shared["COMPOSE_PROJECT_NAME"], undefined);
  assert.equal(shared["PATH"], "/bin");
  assert.equal(shared["IDENTITY_EMAIL_FINGERPRINT_KEY"], "example");
  assert.equal(mcp, undefined);
  assert.equal(shared["NODE_ENV"], "development");
  assert.equal(web["NODE_ENV"], "production");
  assert.equal(
    web["CSP_LOCAL_OBJECT_STORAGE_ORIGIN"],
    "http://127.0.0.1:29000",
  );
  assert.equal(urls.mcp, undefined);
});

test("sign-in sets the instance's session cookie and opens only a path of its web", async (t) => {
  const webBaseUrl = "http://127.0.0.1:21000";
  const identity = await startFullStackIdentity({
    apiBaseUrl: "http://127.0.0.1:21001",
    webBaseUrl,
    appId: "inside-web-light-0123456789",
  });
  t.after(() => identity.close());
  const signIn = lightSignInHandler(identity, webBaseUrl);

  const owner = await signIn("GET", "/sign-in?as=owner&next=/account");
  assert.equal(owner.status, 302);
  assert.equal(owner.headers["location"], `${webBaseUrl}/account`);
  assert.match(
    owner.headers["set-cookie"] ?? "",
    /^logto_inside-web-light-0123456789=[^;\s]{40,}; Path=\//u,
  );

  assert.equal((await signIn("GET", "/sign-in?as=learner")).status, 302);
  assert.equal((await signIn("GET", "/sign-in?as=holder")).status, 302);
  assert.equal((await signIn("GET", "/sign-in?as=newcomer")).status, 302);
  assert.equal((await signIn("GET", "/sign-in?as=admin")).status, 404);
  assert.equal((await signIn("GET", "/sign-in?next=//evil.test")).status, 400);
  assert.equal((await signIn("GET", "/sign-in?next=/\\evil.test")).status, 400);
  assert.equal(
    (await signIn("GET", "/sign-in?next=https://evil.test")).status,
    400,
  );
  const out = await signIn("GET", "/sign-out");
  assert.match(out.headers["set-cookie"] ?? "", /Max-Age=0/u);
});

test("status lists recorded instances and refuses a damaged record", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "stand-light-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await listLightStates(join(directory, "missing")), []);
  await mkdir(directory, { recursive: true });
  /** @type {import("./stand-light-plan.mjs").LightState} */
  const state = {
    version: 1,
    id: "0123456789",
    worktree: "/work/a",
    pid: 4242,
    phase: "ready",
    web: "production",
    startedAt: "2026-11-16T10:00:00.000Z",
    readyAt: "2026-11-16T10:01:00.000Z",
    database: "inside_light_0123456789",
    composeProject: "inside-platform",
    urls: {
      web: "http://127.0.0.1:21000",
      api: "http://127.0.0.1:21001",
      mcp: null,
      signIn: "http://127.0.0.1:21002/sign-in",
    },
    failure: null,
  };
  await writeFile(join(directory, "0123456789.json"), JSON.stringify(state));
  assert.deepEqual(await listLightStates(directory), [state]);
  await writeFile(join(directory, "abcdefabcd.json"), "{");
  await assert.rejects(
    listLightStates(directory),
    /state abcdefabcd is invalid/u,
  );
});

test("instance memory counts the supervisor and every descendant, not other processes", () => {
  const table = [
    { pid: 10, ppid: 1, rss: 100 },
    { pid: 11, ppid: 10, rss: 200 },
    { pid: 12, ppid: 11, rss: 300 },
    { pid: 20, ppid: 1, rss: 5_000 },
  ];
  assert.equal(treeResidentKiB(table, 10), 600);
  assert.equal(treeResidentKiB(table, 99), 0);
});

test("named roles accept the terms and get a fictional name without a pre-existing Product dependency", async () => {
  /** @type {{ call: string; body: unknown }[]} */
  const calls = [];
  const terms = "/accounts/current/legal-acceptances/terms";
  await seedLightRoles({
    api: "http://127.0.0.1:1",
    createAccessToken: (subject) =>
      Promise.resolve({ token: `token:${subject ?? ""}`, expiresAt: 0 }),
    operationId: () => "33333333-3333-4333-8333-333333333333",
    request: (url, init) => {
      const subject = init.headers.authorization.replace("Bearer token:", "");
      const path = new URL(url).pathname;
      calls.push({
        call: `${subject} ${init.method} ${path}`,
        body:
          init.body === undefined
            ? undefined
            : /** @type {unknown} */ (JSON.parse(init.body)),
      });
      const answer =
        path === "/accounts"
          ? { account: { accountId: "11111111-1111-4111-8111-111111111111" } }
          : path === terms
            ? { document: { version: "1", digest: "d".repeat(64) } }
            : {};
      return Promise.resolve(
        new Response(JSON.stringify(answer), {
          status: init.method === "GET" ? 200 : 201,
        }),
      );
    },
  });
  const accepted = {
    operationId: "33333333-3333-4333-8333-333333333333",
    version: "1",
    digest: "d".repeat(64),
    buttonLabel: "Light instance role setup",
  };
  assert.deepEqual(calls, [
    { call: "light-holder POST /accounts", body: undefined },
    { call: "light-learner POST /accounts", body: undefined },
    { call: "light-newcomer POST /accounts", body: undefined },
    { call: `fullstack-owner GET ${terms}`, body: undefined },
    { call: `fullstack-owner POST ${terms}`, body: accepted },
    {
      call: "fullstack-owner POST /account/profile",
      body: { displayName: "Владелец Тестов" },
    },
    { call: `light-holder GET ${terms}`, body: undefined },
    { call: `light-holder POST ${terms}`, body: accepted },
    {
      call: "light-holder POST /account/profile",
      body: { displayName: "Покупатель Тестов" },
    },
    { call: `light-learner GET ${terms}`, body: undefined },
    { call: `light-learner POST ${terms}`, body: accepted },
    {
      call: "light-learner POST /account/profile",
      body: { displayName: "Участник Тестов" },
    },
  ]);
  assert.equal(lightRoles.newcomer.name, null);
  assert.equal(Object.hasOwn(lightRoles.holder, "productId"), false);
  assert.deepEqual([...lightRoleNames], Object.keys(lightRoles));
});

test("a refused role request stops the instance with the request named", async () => {
  await assert.rejects(
    seedLightRoles({
      api: "http://127.0.0.1:1",
      createAccessToken: () => Promise.resolve({ token: "t", expiresAt: 0 }),
      request: () => Promise.resolve(new Response("{}", { status: 403 })),
    }),
    /POST \/accounts for holder returned HTTP 403/u,
  );
});
