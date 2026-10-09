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
    await guardPassContext(context, blocked);
    let problem: string | undefined;
    try {
      await observeBodyPage(context, "closed", snippet);
    } catch (error) {
      problem = problemLine(error);
    }
    expect(problem).toContain("ERR_BLOCKED_BY_CLIENT");
    expect(blocked).toEqual([
      {
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
      reason: expect.stringContaining("ERR_BLOCKED_BY_CLIENT"),
    });
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
