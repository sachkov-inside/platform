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
  "apps/backend/scripts/measure-web-telemetry.ts",
  "scripts/billing-contact-proof.mjs",
  "scripts/production-verify/test_sql.py",
  "apps/telegram/scripts/production-smoke.sh",
];

// Owner-approved #1396 packet65c84186; anonymous complete-index verification passed.
const runtimePins = new Map([
  [
    "postgres:18.4-alpine",
    "sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15",
  ],
  [
    "postgres:18.4-alpine3.23",
    "sha256:996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e",
  ],
  [
    "node:26.10.0-alpine3.24",
    "sha256:0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80",
  ],
]);

// Authorized #1337 inputs; these are the original official OCI indexes, not new builds.
const rabbitmqPins = new Map([
  [
    "4.2.4-management-alpine",
    "sha256:adac51a4a14a200b8eb928a12787564ed56e93fc55e789a73ec13e1e2eac7aef",
  ],
  [
    "4.2.4-alpine",
    "sha256:83522278ca69414e4895b3ea3c0f943c63ad316c063f9cda9c32fd42fe800f47",
  ],
  [
    "4.3-management-alpine",
    "sha256:3ef7f7e89fed709a78f79b8b5f4e30e1312a1d4089da752e23595566d9d61a95",
  ],
]);

test("official acquisition inputs select authorized GHCR mirrors, pinned Hub Node and remaining immutable ECR inputs", () => {
  for (const path of inputPaths) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    // A dotted version excludes service URLs such as rabbitmq:5671 and postgres:5432.
    const references = source.matchAll(
      /(?:public\.ecr\.aws\/docker\/library\/|docker\.io\/library\/|ghcr\.io\/sachkov-inside\/)?(?:node|postgres|rabbitmq|caddy):\d+\.\d+[\w.-]*(?:@sha256:[a-f0-9]{64})?/gu,
    );
    let count = 0;
    for (const [reference] of references) {
      count++;
      const image = reference.split("/").at(-1)?.split("@")[0];
      assert.ok(image, `${path}: missing official image identity`);
      const runtimeDigest = runtimePins.get(image);
      if (runtimeDigest !== undefined) {
        assert.equal(
          reference,
          `ghcr.io/sachkov-inside/${image}@${runtimeDigest}`,
          `${path}: ${image} must use its verified public mirror without changing identity`,
        );
        continue;
      }
      if (image === "node:26.10.0-bookworm-slim") {
        assert.equal(
          reference,
          "docker.io/library/node:26.10.0-bookworm-slim@sha256:662933cf47f013bc8e4beb31a6116448427a82057ba7c42c97e4c5ba766504c2",
          `${path}: Telegram Node must preserve its official index through Docker Hub (#1432)`,
        );
        continue;
      }
      assert.match(
        reference,
        reference.includes("rabbitmq:")
          ? /^ghcr\.io\/sachkov-inside\/rabbitmq:\S+@sha256:[a-f0-9]{64}$/u
          : /^public\.ecr\.aws\/docker\/library\/\S+@sha256:[a-f0-9]{64}$/u,
        `${path}: ${reference} must use its approved registry and immutable digest`,
      );
      if (reference.includes("rabbitmq:")) {
        const [tag, digest] = reference.split("rabbitmq:")[1]?.split("@") ?? [];
        assert.ok(tag, `${path}: missing RabbitMQ tag`);
        assert.equal(
          digest,
          rabbitmqPins.get(tag),
          `${path}: RabbitMQ identity changed`,
        );
      }
    }
    assert.ok(count > 0, `${path} must declare its official image input`);
  }
});

test("RabbitMQ publisher is restricted to trusted pushes/main dispatch and preserves all three public indexes", () => {
  const publisher = readFileSync(
    new URL("../.github/workflows/rabbitmq-mirror.yml", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    publisher,
    /^ {2}(pull_request|pull_request_target|workflow_run|workflow_call):/mu,
  );
  assert.match(publisher, /permissions: \{\}/u);
  assert.match(publisher, /github\.repository == 'sachkov-inside\/platform'/u);
  assert.match(publisher, /github\.event_name == 'push'/u);
  assert.match(publisher, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(publisher, /branches: \[main\]/u);
  assert.doesNotMatch(publisher, /fix\/1337-release-infrastructure/u);
  assert.match(publisher, /github\.event_name == 'workflow_dispatch'/u);
  assert.match(publisher, /packages: write/u);
  assert.match(publisher, /GHCR_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.doesNotMatch(
    publisher,
    /secrets\.|actions\/checkout|download-artifact|inputs\./u,
  );
  assert.equal((publisher.match(/- tag:/gu) ?? []).length, 3);
  for (const [tag, digest] of rabbitmqPins) {
    assert.ok(
      publisher.includes(`- tag: ${tag}\n            digest: ${digest}`),
      tag,
    );
  }
  assert.match(
    publisher,
    /skopeo copy --all --preserve-digests --retry-times 0/u,
  );
  assert.match(publisher, /printf '\{"auths":\{\}\}\\n'/u);
  assert.match(
    publisher,
    /cmp "\$proof\/upstream-index\.json" "\$proof\/ghcr-index\.json"/u,
  );
  assert.match(publisher, /\.manifests\[\]\.digest/u);
  assert.match(publisher, /sha256sum --check/u);
});

test("runtime publisher admits only the three owner-approved immutable indexes on trusted main", () => {
  const publisher = readFileSync(
    new URL(
      "../.github/workflows/official-runtime-mirror.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const approvedInputs = [
    [
      "postgres",
      "18.4-alpine",
      "9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15",
    ],
    [
      "postgres",
      "18.4-alpine3.23",
      "996d0920e4ff9df1fc19dacb904492f3c1ec0ec1cc338f0ad7123be7731c5f5e",
    ],
    [
      "node",
      "26.10.0-alpine3.24",
      "0b36e8c136b94cd4fcf02188228e76c31ad5872eef3fec8cbd2eee500cfd9e80",
    ],
  ];
  assert.equal((publisher.match(/- image:/gu) ?? []).length, 3);
  for (const [image, tag, digest] of approvedInputs) {
    assert.ok(
      publisher.includes(
        `- image: ${image}\n            tag: ${tag}\n            digest: sha256:${digest}`,
      ),
      `${image}:${tag} must preserve its approved official index`,
    );
  }
  assert.match(publisher, /permissions: \{\}/u);
  assert.match(publisher, /branches: \[main\]/u);
  assert.match(publisher, /github\.repository == 'sachkov-inside\/platform'/u);
  assert.match(publisher, /github\.ref == 'refs\/heads\/main'/u);
  assert.match(publisher, /github\.event_name == 'push'/u);
  assert.match(publisher, /github\.event_name == 'workflow_dispatch'/u);
  assert.doesNotMatch(
    publisher,
    /^ {2}(pull_request|pull_request_target|workflow_run|workflow_call):|secrets\.|actions\/checkout|download-artifact|inputs\./mu,
  );
  assert.match(publisher, /packages: write/u);
  assert.match(publisher, /GHCR_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(
    publisher,
    /skopeo copy --all --preserve-digests --retry-times 0/u,
  );
  assert.match(
    publisher,
    /docker:\/\/docker\.io\/library\/\$IMAGE_NAME@\$IMAGE_DIGEST/u,
  );
  assert.match(
    publisher,
    /docker:\/\/ghcr\.io\/sachkov-inside\/\$IMAGE_NAME:\$IMAGE_TAG/u,
  );
  assert.match(publisher, /printf '\{"auths":\{\}\}\\n'/u);
  assert.match(
    publisher,
    /cmp "\$proof\/upstream-index\.json" "\$proof\/ghcr-index\.json"/u,
  );
  assert.match(publisher, /sha256sum --check/u);
  assert.match(publisher, /\.platform\.architecture == "amd64"/u);
  assert.match(publisher, /\.platform\.architecture == "arm64"/u);
  assert.match(publisher, /\.manifests\[\]\.digest/u);
  assert.match(
    publisher,
    /cmp "\$proof\/upstream-\$\{digest#sha256:\}\.json" "\$proof\/ghcr-\$\{digest#sha256:\}\.json"/u,
  );
});
