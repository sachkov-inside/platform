import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { readBlockedRequests } from "../production/pass-report";

it("retains every identity and cell when reading blocked request files", () => {
  const directory = mkdtempSync(join(tmpdir(), "inside-pass-report-"));
  try {
    const request = {
      method: "POST",
      target: "https://sachkov.dev/api/reading-progress/states",
      reason: "POST /api/reading-progress/states is not a read",
    };
    const body = {
      ...request,
      identity: "learner-product-a",
      cellId: "learner-product-a/read-product-a/body@browser",
    };
    const assets = {
      ...body,
      cellId: "learner-product-a/read-product-a/assets@browser",
    };
    const anonymous = { ...request, identity: "anonymous" };
    writeFileSync(
      join(directory, "first.json"),
      JSON.stringify([body, anonymous]),
    );
    writeFileSync(
      join(directory, "second.json"),
      JSON.stringify([assets, body]),
    );
    expect(readBlockedRequests(directory)).toEqual([anonymous, assets, body]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("rejects a blocked request file without identity instead of losing attribution", () => {
  const directory = mkdtempSync(join(tmpdir(), "inside-pass-report-"));
  try {
    writeFileSync(
      join(directory, "missing.json"),
      JSON.stringify([
        {
          method: "POST",
          target: "https://sachkov.dev/api/reading-progress/states",
          reason: "not a read",
        },
      ]),
    );
    expect(() => readBlockedRequests(directory)).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
