// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// These are the acquisition boundaries, including services pulled before Actions steps run.
const inputPaths = [
  ".github/workflows/ci.yml",
  "apps/backend/Dockerfile",
  "apps/web/Dockerfile",
  "apps/telegram/infra/production/Dockerfile",
  "infra/production/database/Dockerfile",
  "infra/notifications/Dockerfile",
  "compose.yaml",
  "compose.production.yaml",
  "infra/identity/logto/compose.yaml",
  "apps/telegram/compose.yaml",
  "scripts/fixtures/production-runtime/compose.smoke.yaml",
  "apps/backend/test/integration/setup/postgres.global.ts",
  "apps/backend/src/infrastructure/notification-transport/topology.ts",
  "apps/backend/scripts/enrollment-browser-fixture.ts",
  "apps/backend/scripts/buyer-journey-fixture.ts",
  "scripts/billing-contact-proof.mjs",
  "scripts/production-verify/test_sql.py",
  "apps/telegram/scripts/production-smoke.sh",
];

test("official acquisition inputs select ECR with immutable digests", () => {
  for (const path of inputPaths) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    // A dotted version excludes service URLs such as rabbitmq:5671 and postgres:5432.
    const references = source.matchAll(
      /(?:public\.ecr\.aws\/docker\/library\/|docker\.io\/library\/)?(?:node|postgres|rabbitmq|caddy):\d+\.\d+[\w.-]*(?:@sha256:[a-f0-9]{64})?/gu,
    );
    let count = 0;
    for (const [reference] of references) {
      count++;
      assert.match(
        reference,
        /^public\.ecr\.aws\/docker\/library\/\S+@sha256:[a-f0-9]{64}$/u,
        `${path}: ${reference} would use Docker Hub or a mutable tag`,
      );
    }
    assert.ok(count > 0, `${path} must declare its official image input`);
  }
});
