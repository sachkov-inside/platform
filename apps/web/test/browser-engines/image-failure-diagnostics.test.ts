import assert from "node:assert/strict";
import { test } from "vitest";
import { z } from "zod";
import { once } from "node:events";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import { observeImageFailure } from "../support/image-failure-diagnostics";

test("image snapshot keeps pending redirect timings and image state without signed queries", async (t) => {
  const server = createServer((req, res) => {
    if (req.url?.startsWith("/redirect") === true) {
      res.writeHead(302, { location: "/dark.webp?signature=SECRET_SENTINEL" });
      res.end();
    }
    // The image response deliberately remains pending; this tests diagnostics, not historical causality.
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.onTestFinished(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address !== null && typeof address !== "string");
  const browser = await chromium.launch({ headless: true });
  t.onTestFinished(() => browser.close());
  const page = await browser.newPage();
  const observation = observeImageFailure(page);
  t.onTestFinished(() => {
    observation.dispose();
  });
  const requested = page.waitForRequest((request) =>
    request.url().includes("/dark.webp"),
  );
  await page.setContent(
    `<img src="http://127.0.0.1:${String(address.port)}/redirect?token=SECRET_SENTINEL">`,
    { waitUntil: "commit" },
  );
  await requested;
  const snapshot = await observation.snapshot();
  const image = snapshot.images[0];
  assert.ok(image);
  assert.equal(image.complete, false);
  assert.equal(image.naturalWidth, 0);
  assert.ok(snapshot.requests.some((request) => request.status === 302));
  assert.ok(
    snapshot.requests.some(
      (request) =>
        request.url.endsWith("/dark.webp") &&
        request.state === "pending" &&
        request.id > 0,
    ),
  );
  assert.ok(!JSON.stringify(snapshot).includes("SECRET_SENTINEL"));
  assert.ok(JSON.stringify(snapshot).length < 65536);
  const flood = page.waitForRequest((request) =>
    request.url().includes("/pending/79"),
  );
  await page.evaluate(
    (origin) => {
      for (let index = 0; index < 80; index++) {
        const image = document.createElement("img");
        image.src = `${origin}/pending/${String(index)}?token=SECRET_SENTINEL`;
        document.body.append(image);
      }
    },
    `http://127.0.0.1:${String(address.port)}`,
  );
  await flood;
  const bounded = await observation.snapshot();
  assert.equal(bounded.requests.length, 64);
  assert.equal(bounded.images.length, 32);
  assert.ok(JSON.stringify(bounded).length < 131072);
  assert.ok(!JSON.stringify(bounded).includes("SECRET_SENTINEL"));
  await page.route("**/failed.webp*", (route) => route.abort());
  const failed = page.waitForEvent("requestfailed", {
    predicate: (request) => request.url().includes("/failed.webp"),
  });
  await page.evaluate(() => {
    const failedImage = document.createElement("img");
    failedImage.src = "http://127.0.0.1/failed.webp?token=SECRET_SENTINEL";
    document.body.append(failedImage);
  });
  await failed;
  assert.ok(
    (await observation.snapshot()).requests.some(
      (request) => request.state === "failed",
    ),
  );
  observation.dispose();
  assert.deepEqual((await observation.snapshot()).requests, []);
  await page.close();
  assert.equal((await observation.snapshot()).imageState, "unavailable");
});

test("owned failing Playwright test attaches image evidence and preserves failure exit", async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } =
    await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { resolve } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const fixture = mkdtempSync(resolve(tmpdir(), "image-failure-run-"));
  try {
    const output = resolve(fixture, "report.json");
    const config = resolve(fixture, "playwright.config.cjs");
    writeFileSync(
      config,
      `module.exports = ${JSON.stringify({
        testDir: fixture,
        outputDir: resolve(fixture, "results"),
        workers: 1,
        reporter: [["json", { outputFile: output }]],
        timeout: 10000,
      })};`,
    );
    writeFileSync(
      resolve(fixture, "failure.spec.ts"),
      `import { test } from ${JSON.stringify(resolve("test/support/image-failure-fixture.ts"))};
      test('controlled image failure', async ({page}) => {
        await page.setContent('<img src="data:image/png;base64,SECRET_SENTINEL">', {waitUntil:'domcontentloaded'});
        throw new Error('controlled image failure');
      });`,
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve("node_modules/@playwright/test/cli.js"),
        "test",
        "--config",
        config,
      ],
      { encoding: "utf8", timeout: 20000 },
    );
    assert.equal(result.status, 1, result.stderr);
    const report = z
      .object({
        suites: z.array(
          z.object({
            specs: z.array(
              z.object({
                tests: z.array(
                  z.object({
                    results: z.array(
                      z.object({
                        status: z.string(),
                        error: z.object({ message: z.string() }),
                        attachments: z.array(
                          z.object({
                            name: z.string(),
                            body: z.string().optional(),
                          }),
                        ),
                      }),
                    ),
                  }),
                ),
              }),
            ),
          }),
        ),
      })
      .parse(JSON.parse(readFileSync(output, "utf8")));
    const failure = report.suites[0]?.specs[0]?.tests[0]?.results[0];
    assert.ok(failure);
    assert.equal(failure.status, "failed");
    assert.match(failure.error.message, /controlled image failure/u);
    const attachment = failure.attachments.find(
      (entry) => entry.name === "image-first-failure",
    );
    assert.ok(attachment);
    assert.equal(typeof attachment.body, "string");
    assert.ok(attachment.body !== undefined);
    const evidence = Buffer.from(attachment.body, "base64").toString();
    assert.ok(evidence.includes('"naturalWidth":0'));
    assert.ok(!evidence.includes("SECRET_SENTINEL"));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
