import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import {
  parseProviderContract,
  validateMaterializedProviderIdentities,
} from "./production-provider-preflight.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exampleContract = JSON.parse(
  await import("node:fs").then(({ readFileSync }) =>
    readFileSync(
      resolve(
        repositoryRoot,
        "infra/production/config/provider-contract.example.json",
      ),
      "utf8",
    )
  ),
);
const validContract = structuredClone(exampleContract);
validContract.email.smtpHost = "smtp.provider.test";
validContract.kinescope.membershipProjectId = "membership-production-01";
validContract.kinescope.publicProjectId = "public-production-01";
validContract.telegram.botStartUrl = "https://t.me/inside_membership_bot";
validContract.telegram.linkingEndpoint =
  "https://telegram.sachkov.dev/integrations/platform/v1/identity-links";

describe("production provider preflight", () => {
  it("accepts the exact release provider contract", () => {
    const parsed = parseProviderContract(validContract);
    assert.equal(parsed.profile, "release");
  });

  it("fails closed for wrong issuer, callback, bucket and credential references", () => {
    assertFailure(
      { identity: { issuer: "https://wrong.example/oidc" } },
      "identity.issuer",
    );
    assertFailure(
      { identity: { callbackUrl: "https://inside.sachkov.dev/wrong" } },
      "identity.callbackUrl",
    );
    assertFailure(
      { backups: { bucket: validContract.assets.publicBucket } },
      "backups.bucket",
    );
    assertFailure(
      {
        backups: {
          accessKeyIdRef: validContract.assets.accessKeyIdRef,
        },
      },
      "backups.accessKeyIdRef",
    );
    assertFailure(
      { telegram: { linkingSecretRef: undefined } },
      "telegram.linkingSecretRef",
    );
    assert.throws(
      () => parseProviderContract(exampleContract),
      /configured provider/u,
    );
  });

  it("permits an explicit degraded profile without provider credentials", () => {
    const degraded = structuredClone(validContract);
    degraded.profile = "degraded";
    for (const provider of ["assets", "email", "kinescope", "mcp", "telegram"]) {
      degraded[provider] = { state: "disabled" };
    }
    assert.equal(parseProviderContract(degraded).profile, "degraded");
  });

  it("checks materialized backup and asset identities without disclosing them", () => {
    const runtime = mkdtempSync(resolve(tmpdir(), "inside-provider-secrets-"));
    const current = resolve(runtime, "current");
    mkdirSync(current);
    const sensitiveMarker = "never-print-this-access-key";
    writeFileSync(
      resolve(current, "api.env"),
      `OBJECT_STORAGE_ACCESS_KEY_ID=${JSON.stringify(sensitiveMarker)}\n`,
    );
    writeFileSync(
      resolve(current, "pgbackrest.env"),
      `PGBACKREST_REPO1_S3_KEY=${JSON.stringify(sensitiveMarker)}\n`,
    );
    assert.throws(
      () => validateMaterializedProviderIdentities(runtime),
      (error) => {
        assert.doesNotMatch(error.message, new RegExp(sensitiveMarker, "u"));
        assert.match(error.message, /identities must be distinct/u);
        return true;
      },
    );
  });
});

function assertFailure(overrides, expectedMessage) {
  const input = structuredClone(validContract);
  for (const [section, values] of Object.entries(overrides)) {
    input[section] = { ...input[section], ...values };
  }
  assert.throws(
    () => parseProviderContract(input),
    new RegExp(expectedMessage, "u"),
  );
}
