// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  readStandKinescope,
  removeStandKinescope,
  standKinescopeEnvironment,
  writeStandKinescope,
} from "./stand-kinescope.mjs";

const production = [
  "NODE_ENV=production",
  "KINESCOPE_PROVIDER_MODE=real",
  "KINESCOPE_API_BASE_URL=https://api.kinescope.io",
  "KINESCOPE_UPLOADER_BASE_URL=https://uploader.kinescope.io",
  "KINESCOPE_API_TOKEN=fixture-production-token-value",
  "KINESCOPE_PUBLIC_PROJECT_ID=public-project",
  "KINESCOPE_MEMBERSHIP_PROJECT_ID=membership-project",
  "KINESCOPE_CALLBACK_PASSWORD=fixture-callback-password",
  "KINESCOPE_WEBHOOK_PASSWORD=fixture-webhook-password",
  "KINESCOPE_PLAYBACK_JWT_SECRET=fixture-production-playback-secret",
  "DATABASE_URL=postgresql://fixture",
].join("\n");

test("import keeps only provider access and selects the real adapter", () => {
  const text = standKinescopeEnvironment(production);
  assert.deepEqual(text.trim().split("\n"), [
    "KINESCOPE_PROVIDER_MODE=real",
    "KINESCOPE_API_BASE_URL=https://api.kinescope.io",
    "KINESCOPE_UPLOADER_BASE_URL=https://uploader.kinescope.io",
    "KINESCOPE_API_TOKEN=fixture-production-token-value",
    "KINESCOPE_PUBLIC_PROJECT_ID=public-project",
    "KINESCOPE_MEMBERSHIP_PROJECT_ID=membership-project",
  ]);
  for (const secret of [
    "callback",
    "webhook",
    "playback-secret",
    "postgresql",
    "NODE_ENV",
  ])
    assert.ok(!text.includes(secret), secret);
});

test("import refuses an incomplete or ambiguous provider set without echoing values", () => {
  assert.throws(
    () =>
      standKinescopeEnvironment(
        production.replace(/^KINESCOPE_API_TOKEN=.*$/mu, ""),
      ),
    (error) =>
      error instanceof Error &&
      /KINESCOPE_API_TOKEN/u.test(error.message) &&
      !error.message.includes("public-project"),
  );
  assert.throws(
    () =>
      standKinescopeEnvironment(
        `${production}\nKINESCOPE_PUBLIC_PROJECT_ID=other-project`,
      ),
    (error) =>
      error instanceof Error &&
      /twice/u.test(error.message) &&
      !error.message.includes("other-project"),
  );
  assert.throws(
    () =>
      standKinescopeEnvironment(
        production.replace(
          "https://api.kinescope.io",
          "https://api.example.invalid",
        ),
      ),
    /kinescope\.io/u,
  );
});

test("the private file is written atomically with owner-only access and can be removed", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "stand-kinescope-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, ".identity-proof", "stand-kinescope.env");
  assert.equal(await readStandKinescope(path), "test");
  await writeStandKinescope(path, standKinescopeEnvironment(production));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(
    (await stat(join(directory, ".identity-proof"))).mode & 0o777,
    0o700,
  );
  assert.match(
    await readFile(path, "utf8"),
    /^KINESCOPE_PROVIDER_MODE=real$/mu,
  );
  assert.equal(await readStandKinescope(path), "real");
  await removeStandKinescope(path);
  assert.equal(await readStandKinescope(path), "test");
  await removeStandKinescope(path);
});
