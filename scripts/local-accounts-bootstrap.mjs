// @ts-check
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { ownerPersonalAccessToken } from "./authoring-stand-gateway.mjs";
import {
  exchangeStandToken,
  localAccountsConfigSchema,
} from "./local-accounts-identity.mjs";
import { validateLocalAccountsSettings } from "./local-accounts-gateway.mjs";
import { ensureSharedIdentityDirectory } from "./shared-identity-directory.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Inspect the selected local Compose service before any identity or Account write. A browser
// Host/header/query or inherited opt-in cannot turn a production API into this development stand.
/** @type {unknown} */
const runtime = JSON.parse(
  execFileSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "api",
      "node",
      "-e",
      "process.stdout.write(JSON.stringify({mode:process.env.NODE_ENV,issuer:process.env.LOGTO_ISSUER}))",
    ],
    {
      cwd: root,
      env: { ...process.env, COMPOSE_PROJECT_NAME: "inside-platform" },
      encoding: "utf8",
      timeout: 10_000,
    },
  ),
);
z.object({
  mode: z.literal("development"),
  issuer: z.literal("https://identity.inside.localhost:3301/oidc"),
}).parse(runtime);
ensureSharedIdentityDirectory(root);
process.env["LOGTO_ON_STAND"] = "true";
const bootstrap = await import("./identity-proof-bootstrap.mjs");
const stand = bootstrap.parseEnv(
  await readFile(resolve(root, ".identity-proof/stand.env"), "utf8"),
);
const exchange = z
  .object({
    LOGTO_ENDPOINT: z.string(),
    LOGTO_AUDIENCE: z.string(),
    AUTHORING_STAND_APP_ID: z.string(),
    AUTHORING_STAND_APP_SECRET: z.string(),
  })
  .parse(
    bootstrap.parseEnv(
      await readFile(
        resolve(root, ".identity-proof/authoring-stand.env"),
        "utf8",
      ),
    ),
  );
validateLocalAccountsSettings({
  mode: process.env["NODE_ENV"] ?? "development",
  endpoint: exchange.LOGTO_ENDPOINT,
  audience: exchange.LOGTO_AUDIENCE,
  webBaseUrl: stand["WEB_BASE_URL"],
});
const api = bootstrap.createManagementApi(
  await bootstrap.fetchManagementAccessToken(
    bootstrap.readSeededManagementSecret(),
  ),
);
const userSchema = z.object({
  id: z.string(),
  primaryEmail: z.string().nullable(),
});
/** @param {string} email */
async function ensureUser(email) {
  const matches = z
    .array(userSchema)
    .parse(await api(`/users?search=${encodeURIComponent(email)}`))
    .filter((user) => user.primaryEmail?.toLowerCase() === email.toLowerCase());
  if (matches.length > 1) throw new Error("Ambiguous local stand identity");
  return (
    matches[0] ??
    userSchema.parse(
      await api("/users", { method: "POST", body: { primaryEmail: email } }),
    )
  );
}
const storedOwner = await readFile(
  resolve(root, ".identity-proof/authoring-owner-pat.json"),
  "utf8",
)
  .then(
    (source) => z.object({ email: z.email() }).parse(JSON.parse(source)).email,
  )
  .catch(() => "owner@inside-local.test");
const owner = await ensureUser(storedOwner);
const learner = await ensureUser("learner@inside-local.test");
const learnerWithAccess = await ensureUser(
  "learner-with-access@inside-local.test",
);
const configPath = resolve(root, ".identity-proof/local-accounts.json");
const previous = await readFile(configPath, "utf8")
  .then((source) => localAccountsConfigSchema.parse(JSON.parse(source)))
  .catch(() => undefined);
/** @param {string} subject @param {"learner" | "learner-with-access"} choice */
async function learnerPat(subject, choice) {
  const old =
    previous?.endpoint === exchange.LOGTO_ENDPOINT
      ? previous.profiles[choice].pat
      : undefined;
  if (old !== undefined && previous !== undefined) {
    try {
      await exchangeStandToken(previous, old);
      return old;
    } catch {
      /* Recreated local identity may invalidate the cached PAT. */
    }
  }
  const name = `inside-local-browser-${choice}`;
  const tokens = z
    .array(z.object({ name: z.string() }))
    .parse(await api(`/users/${subject}/personal-access-tokens`));
  if (tokens.some((token) => token.name === name))
    await api(`/users/${subject}/personal-access-tokens/${name}`, {
      method: "DELETE",
    });
  return z.object({ value: z.string() }).parse(
    await api(`/users/${subject}/personal-access-tokens`, {
      method: "POST",
      body: { name },
    }),
  ).value;
}
const ownerPat = await ownerPersonalAccessToken(exchange, storedOwner, {
  renew: false,
});
const config = localAccountsConfigSchema.parse({
  endpoint: exchange.LOGTO_ENDPOINT,
  audience: exchange.LOGTO_AUDIENCE,
  webBaseUrl: stand["WEB_BASE_URL"],
  appId: stand["LOGTO_APP_ID"],
  cookieSecret: stand["LOGTO_COOKIE_SECRET"],
  exchangeAppId: exchange.AUTHORING_STAND_APP_ID,
  exchangeAppSecret: exchange.AUTHORING_STAND_APP_SECRET,
  profiles: {
    owner: { pat: ownerPat },
    learner: { pat: await learnerPat(learner.id, "learner") },
    "learner-with-access": {
      pat: await learnerPat(learnerWithAccess.id, "learner-with-access"),
    },
  },
});
try {
  await exchangeStandToken(config, config.profiles.owner.pat);
} catch {
  config.profiles.owner.pat = await ownerPersonalAccessToken(
    exchange,
    storedOwner,
    { renew: true },
  );
}
// PAT exchange proves an existing identity, not a fresh interactive sign-in. The trusted
// development bootstrap establishes the fixture Accounts, as the owner release bootstrap does.
// Ordinary API requests still verify the JWT and resolve the established Account.
const subjects = {
  owner: owner.id,
  learner: learner.id,
  learnerWithAccess: learnerWithAccess.id,
};
execFileSync(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "-e",
    `LOCAL_STAND_ACCOUNT_SUBJECTS=${JSON.stringify(subjects)}`,
    "api",
    "pnpm",
    "--filter",
    "@inside/backend",
    "exec",
    "tsx",
    "src/development/bootstrap-local-stand-accounts.ts",
  ],
  {
    cwd: root,
    env: { ...process.env, COMPOSE_PROJECT_NAME: "inside-platform" },
    stdio: "inherit",
    timeout: 60_000,
  },
);
const temporary = `${configPath}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(config)}\n`, { mode: 0o600 });
await chmod(temporary, 0o600);
await rename(temporary, configPath);
process.stdout.write(
  "Local stand accounts ready: owner, learner with access, learner without access, guest.\n",
);
