// @ts-check
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawnOwned, stopOwned } from "./owned-process.mjs";
import { commandExit } from "./diagnostic-command.mjs";
import { test } from "node:test";

// Failure bounds for real loopback HTTP/Bash/curl contracts, not product request timings.
const processFailureBudgetMs = 5000;
const processShutdownGraceMs = 100;
const serverShutdownBudgetMs = 1000;
const stalledProcessFailureBudgetMs = 1000;

/**
 * @param {import("node:test").TestContext} t
 * @param {string} section
 * @param {{env?: NodeJS.ProcessEnv, signal?: AbortSignal, failureBudgetMs?: number}} [options]
 */
async function execute(t, section, options = {}) {
  const child = spawnOwned("/bin/bash", ["-euc", section], {
    env: options.env,
  });
  t.after(() => stopOwned(child, processShutdownGraceMs));
  let stdout = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk) => {
    stdout += chunk;
  });
  // Consume diagnostics so a failing shell cannot block on a full pipe.
  child.stderr?.resume();
  let stoppedBy = "";
  const cancel = () => {
    stoppedBy ||= "cancelled";
    void stopOwned(child, processShutdownGraceMs);
  };
  const signal = options.signal ?? t.signal;
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  // deterministic-test-allow duration-wait: execution failure budget; supervisor exit is the completion barrier.
  const deadline = setTimeout(() => {
    stoppedBy ||= "deadline";
    void stopOwned(child, processShutdownGraceMs);
  }, options.failureBudgetMs ?? processFailureBudgetMs);
  try {
    return { status: await commandExit(child), stoppedBy, stdout };
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", cancel);
    await stopOwned(child, processShutdownGraceMs);
  }
}

/**
 * @param {import("node:test").TestContext} t
 * @param {import("node:http").RequestListener} handler
 */
async function loopback(t, handler) {
  const server = createServer(handler);
  /** @type {Promise<void> | undefined} */
  let closing;
  function close() {
    closing ??= new Promise((resolve, reject) => {
      // deterministic-test-allow duration-wait: bounds loopback teardown after forced connection closure.
      const deadline = setTimeout(
        () => reject(new Error("Loopback cleanup exceeded failure budget")),
        serverShutdownBudgetMs,
      );
      server.closeAllConnections();
      server.close((error) => {
        clearTimeout(deadline);
        if (
          error &&
          !("code" in error && error.code === "ERR_SERVER_NOT_RUNNING")
        )
          reject(error);
        else resolve();
      });
    });
    return closing;
  }
  t.after(close);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, close, url: `http://127.0.0.1:${address.port}` };
}
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
  test(`development Compose pricing HTTP proof: ${scenario}`, async (t) => {
    const endpoint = await loopback(t, (request, response) => {
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
    try {
      const source = readFileSync("scripts/compose-stack-smoke.sh", "utf8");
      // Exercise the real pricing HTTP caller; unrelated BuildKit, MCP and worker proofs stay in Compose.
      const section = source.slice(
        source.indexOf("# Публичная витрина"),
        source.indexOf(
          'curl --fail --silent --show-error --output /dev/null "$web_base_url"',
        ),
      );
      assert.ok(section.length > 0);
      const result = await execute(t, section, {
        env: { ...process.env, api_base_url: endpoint.url },
      });
      assert.equal(result.stoppedBy, "");
      assert.equal(result.status === 0, scenario === "current");
    } finally {
      await endpoint.close();
    }
  });
}

test("production startup-refusal fixture targets the current Product price owner", () => {
  const source = readFileSync("scripts/production-compose-smoke.sh", "utf8");
  const fixture = source.slice(
    source.indexOf('catalog_sql "insert into'),
    source.indexOf("record_stage_timing routes-and-sale-configuration"),
  );
  assert.match(fixture, /insert into products\.products \(id, slug, name\)/u);
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
  test(`development Compose rejects changed persistent seed: ${snapshot.slice(0, 46)}`, async (t) => {
    const source = readFileSync("scripts/compose-stack-smoke.sh", "utf8");
    const section = source.slice(
      source.indexOf('seed_price_snapshot="$('),
      source.indexOf('seed_snapshot="$('),
    );
    const result = await execute(
      t,
      'docker() { printf "%s\\n" "$SEED_RESPONSE"; }\n' + section,
      {
        env: { ...process.env, SEED_RESPONSE: snapshot },
      },
    );
    assert.equal(result.stoppedBy, "");
    assert.equal(
      result.status === 0,
      snapshot.includes(":3000:") && snapshot.startsWith(productId),
    );
  });
}

for (const scenario of ["deadline", "cancelled"]) {
  test(`pricing shell owner cleans stalled curl descendants and loopback sockets: ${scenario}`, async (t) => {
    const controller = new AbortController();
    let requests = 0;
    const endpoint = await loopback(t, () => {
      requests += 1;
      if (scenario === "cancelled") controller.abort();
      // Intentionally no response: cancellation/deadline must release the blocked real curl.
    });
    const result = await execute(
      t,
      'curl --silent "$api_base_url/stall" & curl_pid=$!; printf "%s:%s\\n" "$$" "$curl_pid"; wait "$curl_pid"',
      {
        env: { ...process.env, api_base_url: endpoint.url },
        signal: controller.signal,
        failureBudgetMs: stalledProcessFailureBudgetMs,
      },
    );
    assert.equal(requests, 1);
    assert.equal(result.stoppedBy, scenario);
    const match = /^(\d+):(\d+)\s*$/.exec(result.stdout);
    assert.ok(match, result.stdout);
    for (const pid of [Number(match[1]), Number(match[2])]) {
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    }
    await endpoint.close();
    assert.equal(endpoint.server.listening, false);
    /** @type {Promise<number>} */
    const countedConnections = new Promise((resolve, reject) =>
      endpoint.server.getConnections((error, count) =>
        error ? reject(error) : resolve(count),
      ),
    );
    assert.equal(await countedConnections, 0);
  });
}
