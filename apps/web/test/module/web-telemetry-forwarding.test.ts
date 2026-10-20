import { afterEach, beforeEach, expect, it, vi } from "vitest";

const pending = vi.hoisted(() => ({ work: [] as (() => Promise<void>)[] }));
vi.mock("next/server", () => ({
  after: (work: () => Promise<void>) => {
    pending.work.push(work);
  },
}));
vi.mock("@/shared/auth/index.server", async () => {
  const origin = await import("@/shared/auth/same-origin-mutation.server");
  return {
    isSameOriginMutation: origin.isSameOriginMutation,
    readLogtoBffConfig: () => ({ baseUrl: "https://inside.example.test" }),
  };
});
vi.mock("@/shared/config/index.server", () => ({
  readWebRuntimeMode: () => "development",
  readWebRuntimeConfig: () => ({ backendBaseUrl: "http://api:3001" }),
}));
import {
  handleWebVitalsReport,
  handleRenderErrorReport,
} from "@/features/client-telemetry.server";

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => {
  pending.work = [];
  vi.restoreAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
it("returns before persistence and forwards only telemetry data with a server-derived device", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const response = await handleWebVitalsReport(
    new Request("https://inside.example.test/api/web-vitals", {
      method: "POST",
      headers: {
        origin: "https://inside.example.test",
        "sec-ch-ua-mobile": "?0",
        "user-agent": "Mobi secret",
        cookie: "private",
      },
      body: JSON.stringify({
        route: "/materials/secret",
        metrics: [{ id: "visitor-id", name: "LCP", value: 100 }],
      }),
    }),
  );
  expect(response.status).toBe(204);
  expect(fetch).not.toHaveBeenCalled();
  expect(pending.work).toHaveLength(1);
  await pending.work[0]?.();
  expect(fetch).toHaveBeenCalledWith(
    "http://api:3001/internal/web-telemetry",
    expect.objectContaining({
      body: JSON.stringify({
        kind: "vitals",
        route: "/materials/secret",
        mobile: false,
        metrics: [{ name: "LCP", value: 100 }],
      }),
      headers: { "content-type": "application/json" },
    }),
  );
});
it("keeps the log and success response when persistence fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Database down")));
  const error = vi.spyOn(console, "error");
  const response = await handleRenderErrorReport(
    new Request("https://inside.example.test/api/render-errors", {
      method: "POST",
      headers: { origin: "https://inside.example.test", "user-agent": "Mobi" },
      body: JSON.stringify({
        route: "/account",
        boundary: "public",
        digest: "42",
        name: "Error",
        message: "failed",
      }),
    }),
  );
  expect(response.status).toBe(204);
  expect(pending.work).toHaveLength(1);
  await pending.work[0]?.();
  expect(
    error.mock.calls.some(([line]) =>
      String(line).includes('"event":"client-render-error"'),
    ),
  ).toBe(true);
});

it("redacts error text before both logging and forwarding without retaining metric identifiers", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const error = vi.spyOn(console, "error");
  const info = vi.spyOn(console, "info");
  const response = await handleRenderErrorReport(
    new Request("https://inside.example.test/api/render-errors", {
      method: "POST",
      headers: { origin: "https://inside.example.test" },
      body: JSON.stringify({
        route: "/account",
        boundary: "public",
        digest: "42",
        name: "Error",
        message: "Failed alice@example.test token=private-token",
      }),
    }),
  );
  expect(response.status).toBe(204);
  await pending.work[0]?.();
  const output = JSON.stringify([error.mock.calls, fetch.mock.calls]);
  expect(output).not.toContain("alice@example.test");
  expect(output).not.toContain("private-token");
  expect(output).not.toContain("Failed");
  expect(output).toContain("42");
  await handleWebVitalsReport(
    new Request("https://inside.example.test/api/web-vitals", {
      method: "POST",
      headers: { origin: "https://inside.example.test" },
      body: JSON.stringify({
        route: "/materials/private-person",
        metrics: [
          {
            id: "private-visitor",
            name: "LCP",
            value: 100,
            navigationType: "private-navigation",
          },
        ],
      }),
    }),
  );
  const metrics = JSON.stringify(info.mock.calls);
  expect(metrics).not.toContain("private-person");
  expect(metrics).not.toContain("private-visitor");
  expect(metrics).not.toContain("private-navigation");
  expect(metrics).toContain("LCP");
});

it("does not persist arbitrary client error names, digests or echoed input", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetch);
  const output = vi.spyOn(console, "error");
  await handleRenderErrorReport(
    new Request("https://inside.example.test/api/render-errors", {
      method: "POST",
      headers: { origin: "https://inside.example.test" },
      body: JSON.stringify({
        route: "/account",
        boundary: "public",
        digest: "private-digest",
        name: "Иван Петров",
        message: 'Unexpected JSON {"customer":"Иван Петров"}',
      }),
    }),
  );
  await pending.work[0]?.();
  const saved = JSON.stringify([output.mock.calls, fetch.mock.calls]);
  expect(saved).not.toContain("Иван Петров");
  expect(saved).not.toContain("private-digest");
  expect(saved).toContain("Error");
});
