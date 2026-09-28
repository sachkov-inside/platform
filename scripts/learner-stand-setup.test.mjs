// @ts-check
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  learnerStandProfile,
  writeLearnerStandSetup,
} from "./learner-stand-setup.mjs";

test("local learner instructions specialize both Codex commands from the real template", async () => {
  const root = await mkdtemp(join(tmpdir(), "learner-setup-"));
  try {
    await mkdir(join(root, "apps/web/public"), { recursive: true });
    await mkdir(join(root, ".identity-proof"));
    await cp(
      new URL("../apps/web/public/practice-review-setup.txt", import.meta.url),
      join(root, "apps/web/public/practice-review-setup.txt"),
    );
    await writeLearnerStandSetup(
      root,
      "public-test-client",
      "http://127.0.0.1:3001",
    );
    const text = await readFile(
      join(root, ".identity-proof/practice-review-setup.txt"),
      "utf8",
    );
    assert.ok(text.includes(learnerStandProfile.url));
    assert.equal(
      text.split('oauth.client_id="public-test-client"').length - 1,
      2,
    );
    assert.equal(
      text.split(`oauth.callback_url="${learnerStandProfile.callbackUrl}"`)
        .length - 1,
      2,
    );
    assert.match(
      text,
      /--scopes openid,offline_access,learning:read --no-browser/u,
    );
    assert.match(text, /&prompt=consent/u);
    assert.match(text, /export CODEX_CA_CERTIFICATE=/u);
    assert.match(text, /export NO_PROXY=/u);
    assert.doesNotMatch(
      text,
      /LEARNER_MCP_HOST|--oauth-client-registration|2Б\. Claude Code|4Б\. Claude Code/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
