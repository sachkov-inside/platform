import { createServer } from "node:http";

import { chromium } from "@playwright/test";
import { expect, it } from "vitest";

import { observeBodyPage } from "../production/pass-browser";
import {
  evaluatePass,
  type BlockedPassRequest,
} from "../production/pass-cells";
import { guardPassContext } from "../production/pass-requests";
import { problemLine } from "../production/pass-report";

const cell = {
  id: "anonymous/read-product-a/body@browser",
  expected: "denied",
} as const;
const snippet = "Protected production body text";

it("observes anonymous denial from a successful application response", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: "https://sachkov.dev",
    });
    await context.route("**/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: '<main data-application-content><div data-material-reader-state="access-required">Access required</div></main>',
      }),
    );
    expect(await observeBodyPage(context, "closed", snippet)).toEqual({
      observed: "denied",
      note: "HTTP 200; access-required",
    });
    expect(context.pages()).toHaveLength(0);
  } finally {
    await browser.close();
  }
}, 30_000);

it("reports a blocked outside-host navigation as not_checked, never denied", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: "https://outside.example.test",
    });
    const blocked: BlockedPassRequest[] = [];
    await guardPassContext(context, blocked, {
      identity: "anonymous",
      currentCellId: () => cell.id,
    });
    let problem: string | undefined;
    try {
      await observeBodyPage(context, "closed", snippet);
    } catch (error) {
      problem = problemLine(error);
    }
    expect(problem).toContain("ERR_BLOCKED_BY_CLIENT");
    expect(blocked).toEqual([
      {
        identity: "anonymous",
        cellId: cell.id,
        method: "GET",
        target: "https://outside.example.test/materials/closed",
        reason:
          "origin https://outside.example.test is not in the pass allowlist",
      },
    ]);
    const report = evaluatePass({
      cells: [cell],
      observations: [],
      problems: [{ cellId: cell.id, problem: problem ?? "missing failure" }],
      deployedSha: "a".repeat(40),
      blockedRequests: blocked,
    });
    expect(report.cells[0]).toMatchObject({
      status: "not_checked",
      observed: null,
    });
    expect(report.cells[0]?.reason).toContain("ERR_BLOCKED_BY_CLIENT");
    expect(context.pages()).toHaveLength(0);
  } finally {
    await browser.close();
  }
}, 30_000);

it("does not count an error response with denial markup as denied", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: "https://sachkov.dev",
    });
    await context.route("**/*", (route) =>
      route.fulfill({
        status: 503,
        contentType: "text/html",
        body: '<main data-application-content><div data-material-reader-state="access-required">Access required</div></main>',
      }),
    );
    await expect(observeBodyPage(context, "closed", snippet)).rejects.toThrow(
      "HTTP 503",
    );
    expect(context.pages()).toHaveLength(0);
  } finally {
    await browser.close();
  }
}, 30_000);

it("detects protected bytes even when the application renders denial", async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: "https://sachkov.dev",
    });
    await context.route("**/*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<main data-application-content><div data-material-reader-state="access-required">Access required</div></main><script type="application/json">${JSON.stringify(snippet)}</script>`,
      }),
    );
    expect(await observeBodyPage(context, "closed", snippet)).toEqual({
      observed: "allowed",
    });
    expect(context.pages()).toHaveLength(0);
  } finally {
    await browser.close();
  }
}, 30_000);

it("does not count an outside-host redirect response as anonymous denial", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      '<main data-application-content><div data-material-reader-state="access-required">Access required</div></main>',
    );
  });
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("Missing redirect fixture listener");
    const target = `http://127.0.0.1:${String(address.port)}/materials/closed`;
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        baseURL: "https://sachkov.dev",
      });
      const blocked: BlockedPassRequest[] = [];
      await guardPassContext(context, blocked, {
        identity: "anonymous",
        currentCellId: () => cell.id,
      });
      // Playwright does not intercept the redirect step; the owned responder supplies its final response.
      await context.route("https://sachkov.dev/**", (route) =>
        route.fulfill({ status: 302, headers: { location: target } }),
      );
      let problem: string | undefined;
      try {
        await observeBodyPage(context, "closed", snippet);
      } catch (error) {
        problem = problemLine(error);
      }
      expect(problem).toContain("only HTTPS is allowed");
      expect(blocked).toEqual([
        {
          identity: "anonymous",
          cellId: cell.id,
          method: "GET",
          target,
          reason: "redirect step: only HTTPS is allowed",
          sent: true,
        },
      ]);
      const report = evaluatePass({
        cells: [cell],
        observations: [],
        problems: [{ cellId: cell.id, problem: problem ?? "missing failure" }],
        deployedSha: "a".repeat(40),
        blockedRequests: blocked,
      });
      expect(report.cells[0]).toMatchObject({
        status: "not_checked",
        observed: null,
      });
      expect(report.verdict).toBe("red");
      expect(context.pages()).toHaveLength(0);
    } finally {
      await browser.close();
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => {
        if (error === undefined) resolve();
        else reject(error);
      }),
    );
  }
}, 30_000);

it.each(["learner-product-a", "no-entitlement"] as const)(
  "only the allowed identity gets an asset storage redirect: %s",
  async (identity) => {
    // The owned proxy terminates any storage connection locally; this contract never contacts production.
    const proxy = createServer((_request, response) => {
      response.writeHead(502);
      response.end();
    });
    proxy.on("connect", (_request, socket) => {
      socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    });
    try {
      await new Promise<void>((resolve) =>
        proxy.listen(0, "127.0.0.1", resolve),
      );
      const address = proxy.address();
      if (address === null || typeof address === "string")
        throw new Error("Missing storage fixture proxy");
      const browser = await chromium.launch({
        proxy: { server: `http://127.0.0.1:${String(address.port)}` },
      });
      try {
        const context = await browser.newContext({
          baseURL: "https://sachkov.dev",
        });
        const state =
          identity === "no-entitlement"
            ? "account-without-entitlement"
            : identity;
        const cellId = `${state}/read-product-a/assets@browser`;
        let currentCellId = cellId;
        const blocked: BlockedPassRequest[] = [];
        await guardPassContext(context, blocked, {
          identity,
          currentCellId: () => currentCellId,
        });
        const storage =
          "https://inside-production-protected.storage.yandexcloud.net/materials/m/assets/a/image-960.webp";
        const storageRequests: { method: string; source: string | null }[] = [];
        context.on("request", (request) => {
          if (request.url() === storage)
            storageRequests.push({
              method: request.method(),
              source: request.redirectedFrom()?.url() ?? null,
            });
        });
        await context.route("https://sachkov.dev/api/materials/**", (route) =>
          route.fulfill(
            identity === "learner-product-a"
              ? { status: 302, headers: { location: storage } }
              : { status: 404, body: "Asset not found" },
          ),
        );
        const page = await context.newPage();
        const navigation = page.goto(
          "/api/materials/m/assets/a/images/960?contentVersion=1",
        );
        if (identity === "learner-product-a") {
          // The request failure ends on the local proxy, after Chromium has emitted the actual redirect step.
          await expect(navigation).rejects.toThrow();
          expect(storageRequests).toEqual([
            {
              method: "GET",
              source:
                "https://sachkov.dev/api/materials/m/assets/a/images/960?contentVersion=1",
            },
          ]);
        } else {
          expect((await navigation)?.status()).toBe(404);
          expect(storageRequests).toEqual([]);
        }
        expect(blocked).toEqual([]);
        // Close the failed navigation before starting the independent write probe.
        await page.close();
        const writePage = await context.newPage();
        // A later step cannot relabel a request from a page created by the asset cell.
        currentCellId = `${state}/read-product-a/body@browser`;
        await writePage.evaluate(async (url) => {
          try {
            await fetch(url, { method: "POST", mode: "no-cors" });
          } catch {
            /* guard rejects the request */
          }
        }, storage);
        expect(blocked).toEqual([
          {
            identity,
            cellId,
            method: "POST",
            target: storage,
            reason:
              "protected storage only allows a bodyless GET asset redirect",
          },
        ]);
        await writePage.close();
        expect(context.pages()).toHaveLength(0);
      } finally {
        await browser.close();
      }
    } finally {
      proxy.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        }),
      );
    }
  },
  30_000,
);
