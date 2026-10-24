// @ts-check
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { test } from "node:test";

const execute = promisify(execFile);
const productId = "72000000-0000-4000-8000-000000000007";
const price = {
  product: { id: productId, name: "Руководство «Создание Platform Inside»" },
  firstPriceKopecks: 3000,
  paymentOption: { mode: "one_time", priceKopecks: 3000 },
};

for (const scenario of [
  "current",
  "wrong-price",
  "subscription",
  "retired-route-live",
  "malformed",
]) {
  test(`development Compose pricing HTTP proof: ${scenario}`, async () => {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/billing/offers") {
        response.statusCode = scenario === "retired-route-live" ? 200 : 404;
        response.end("{}");
      } else if (request.url === "/billing/product-prices") {
        const item = structuredClone(price);
        if (scenario === "wrong-price") item.firstPriceKopecks = 1;
        if (scenario === "subscription")
          item.paymentOption.mode = "subscription";
        if (scenario === "malformed") {
          response.end("{broken");
          return;
        }
        response.end(
          JSON.stringify({
            items:
              scenario === "current" || scenario === "retired-route-live"
                ? []
                : [item],
            nextCursor: null,
          }),
        );
      } else {
        response.statusCode = 500;
        response.end("Unexpected smoke request");
      }
    });
    await new Promise((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve(undefined)),
    );
    try {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const source = readFileSync("scripts/compose-stack-smoke.sh", "utf8");
      // Exercise the real pricing HTTP caller; unrelated BuildKit, MCP and worker proofs stay in Compose.
      const section = source.slice(
        source.indexOf("# Публичная витрина"),
        source.indexOf(
          'curl --fail --silent --show-error --output /dev/null "$web_base_url"',
        ),
      );
      assert.ok(section.length > 0);
      let succeeded = true;
      try {
        await execute("/bin/bash", ["-euc", section], {
          env: {
            ...process.env,
            api_base_url: `http://127.0.0.1:${address.port}`,
          },
        });
      } catch {
        succeeded = false;
      }
      assert.equal(succeeded, scenario === "current");
    } finally {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve(undefined))),
      );
    }
  });
}

test("production startup-refusal fixture targets the current Product price owner", () => {
  const source = readFileSync("scripts/production-compose-smoke.sh", "utf8");
  const fixture = source.slice(
    source.indexOf('catalog_sql "insert into'),
    source.indexOf("record_stage_timing routes-and-sale-configuration"),
  );
  assert.match(fixture, /insert into products\.series \(id, slug, name\)/u);
  assert.match(
    fixture,
    /insert into billing\.product_prices\s*\(product_id, revision, name, price_kopecks, published, archived, updated_at\)/u,
  );
  assert.match(
    fixture,
    /expect_sale_configuration_refusal[^\n]*dist\/entrypoints\/api\.js/u,
  );
  assert.match(fixture, /TBANK_CONFIG_JSON is not configured/u);
  assert.match(
    fixture,
    /update billing\.product_prices set published = false/u,
  );
  assert.match(fixture, /restart billing-worker/u);
});

for (const snapshot of [
  "72000000-0000-4000-8000-000000000007:3000:true:false:Руководство «Создание Platform Inside»",
  "72000000-0000-4000-8000-000000000007:1:true:false:Руководство «Создание Platform Inside»",
  "72000000-0000-4000-8000-000000000008:3000:true:false:Руководство «Создание Platform Inside»",
]) {
  test(`development Compose rejects changed persistent seed: ${snapshot.slice(0, 46)}`, async () => {
    const source = readFileSync("scripts/compose-stack-smoke.sh", "utf8");
    const section = source.slice(
      source.indexOf('seed_price_snapshot="$('),
      source.indexOf('seed_snapshot="$('),
    );
    let succeeded = true;
    try {
      await execute(
        "/bin/bash",
        ["-euc", 'docker() { printf "%s\\n" "$SEED_RESPONSE"; }\n' + section],
        { env: { ...process.env, SEED_RESPONSE: snapshot } },
      );
    } catch {
      succeeded = false;
    }
    assert.equal(
      succeeded,
      snapshot.includes(":3000:") && snapshot.startsWith(productId),
    );
  });
}
