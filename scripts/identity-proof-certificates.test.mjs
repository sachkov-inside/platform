// @ts-check
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { X509Certificate } from "node:crypto";

test("local TLS uses a signed server leaf and preserves the pair on repeat", (t) => {
  const root = mkdtempSync(join(tmpdir(), "inside-tls-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = resolve("scripts/identity-proof-certificates.mjs");
  const run = () => execFileSync(process.execPath, [script], { cwd: root });
  run();
  const certificate = join(root, ".identity-proof/tls/certificate.pem");
  const before = readFileSync(certificate, "utf8");
  const leaf = new X509Certificate(before);
  const ca = new X509Certificate(
    readFileSync(join(root, ".identity-proof/tls/ca.pem")),
  );
  assert.equal(leaf.ca, false);
  assert.equal(ca.ca, true);
  assert.equal(
    leaf.checkHost("identity.inside.localhost"),
    "identity.inside.localhost",
  );
  assert.equal(leaf.verify(ca.publicKey), true);
  run();
  assert.equal(readFileSync(certificate, "utf8"), before);
});
