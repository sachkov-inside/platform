import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { executeCommunications } from "../../src/_pages/communications/api/response.server";
import {
  saveFunnel,
  publishFunnel,
  resolveTemplate,
  retryDelivery,
  skipDelivery,
} from "../../src/_pages/communications/api/communications.browser";
import {
  contentSchema,
  newFunnel,
  funnelSchema,
  previewSchema,
} from "../../src/_pages/communications/model/communications";
import { handlePublishFunnel } from "../../src/_pages/communications/api/communications-route.server";
vi.mock("../../src/shared/auth/platform-access-token.server", () => ({
  getPlatformAccessToken: vi.fn(() => Promise.resolve("synthetic-token")),
  LogtoSessionUnavailableError: class extends Error {},
}));
vi.mock("../../src/shared/auth/logto-bff-config.server", () => ({
  readLogtoBffConfig: () => ({ baseUrl: "https://inside.example" }),
}));
const session = vi.hoisted(() => ({
  accessToken: vi.fn(() => Promise.resolve("synthetic-token")),
}));
vi.mock("../../src/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: session.accessToken,
    baseUrl: () => "https://inside.example",
  },
  LogtoSessionUnavailableError: class extends Error {},
}));
const id = "30800000-0000-4000-8000-000000000001";
const publishRequest = (input: unknown, origin = "https://inside.example") =>
  new Request("https://inside.example/api/communications/funnels/publish", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
describe("communications browser and presentation boundary", () => {
  it("preserves button rows while omitting an absent row from the provider shape", () => {
    const button = { text: "Open", url: "https://inside.test/material" };
    const content = contentSchema.parse({
      type: "text",
      text: "Post",
      entities: [],
      buttons: [
        { ...button, row: undefined },
        { ...button, row: 0 },
        { ...button, row: 3 },
      ],
    });
    expect(content.buttons).toEqual([
      button,
      { ...button, row: 0 },
      { ...button, row: 3 },
    ]);
    expect(content.buttons[0]).not.toHaveProperty("row");
    expect(
      contentSchema.safeParse({ ...content, buttons: [{ ...button, row: 20 }] })
        .success,
    ).toBe(false);
  });
  it("preserves operation identity and stale revision on repeated save without publishing", async () => {
    const draft = { ...newFunnel(), name: "Test" };
    draft.entryResponse.parts.push({
      partId: id,
      content: { type: "text", text: "Hello", entities: [], buttons: [] },
    });
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        Response.json({ kind: "ready", value: { ...draft, revision: 1 } }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const input = { draft, operationId: id, expectedRevision: 0 };
    await saveFunnel(input);
    await saveFunnel(input);
    expect(fetcher.mock.calls).toHaveLength(2);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url).toBe("/api/communications/funnels/save");
      expect(options?.method).toBe("POST");
      expect(new Headers(options?.headers).get("content-type")).toBe(
        "application/json",
      );
      expect(JSON.parse(z.string().parse(options?.body))).toEqual(input);
    }
  });
  it("keeps publish, template resolution, retry and skip on their own literal routes", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ kind: "error", code: "unavailable" })),
    );
    vi.stubGlobal("fetch", fetcher);
    const command = { operationId: id, expectedRevision: 4, funnelId: id };
    await publishFunnel(command);
    await resolveTemplate({ operationId: id, reference: "template-id" });
    const decision = {
      operationId: id,
      expectedRevision: 5,
      deliveryId: id,
      partId: id,
      duplicateRiskAccepted: true,
    };
    await retryDelivery(decision);
    await skipDelivery(decision);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/communications/funnels/publish",
      "/api/communications/templates/resolve",
      "/api/communications/deliveries/retry",
      "/api/communications/deliveries/skip",
    ]);
  });
  it("maps a failed or malformed answer to the old browser outcome", async () => {
    const command = { operationId: id, expectedRevision: 4, funnelId: id };
    for (const [response, code] of [
      [new Response(null, { status: 401 }), "unauthorized"],
      [new Response(null, { status: 403 }), "forbidden"],
      [new Response(null, { status: 500 }), "unavailable"],
      [new Response("not json"), "unavailable"],
      [
        Response.json({ kind: "ready", value: { funnelId: "bad" } }),
        "unavailable",
      ],
      [Response.json({ kind: "error", code: "unknown" }), "unavailable"],
      [Response.json({ kind: "error", code: "conflict" }), "conflict"],
    ] as const) {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(response)),
      );
      expect(await publishFunnel(command)).toEqual({ kind: "error", code });
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
    expect(await publishFunnel(command)).toEqual({
      kind: "error",
      code: "unavailable",
    });
  });
  it("rejects an invalid command before transport and preserves conflict/unavailable/not-implemented outcomes", async () => {
    const invalid = await handlePublishFunnel(
      publishRequest({ funnelId: "bad" }),
    );
    expect(invalid.status).toBe(200);
    expect(await invalid.json()).toEqual({ kind: "error", code: "invalid" });
    for (const [code, status, expected] of [
      ["revision_conflict", 409, "conflict"],
      ["provider_unavailable", 503, "unavailable"],
      ["not_implemented", 501, "not_implemented"],
      ["forbidden", 403, "forbidden"],
    ] as const) {
      expect(
        await executeCommunications(funnelSchema, "funnel", () =>
          Promise.resolve({
            ok: false,
            problem: { code },
            response: new Response(null, { status }),
          }),
        ),
      ).toEqual({ kind: "error", code: expected });
    }
  });
  it("rejects false success and maps Platform target validation into the preview", async () => {
    expect(
      await executeCommunications(funnelSchema, "funnel", () =>
        Promise.resolve({
          ok: true,
          body: { ok: true, value: { status: "ok" } },
          response: new Response(),
        }),
      ),
    ).toEqual({ kind: "error", code: "unavailable" });
    const value = {
      funnelId: id,
      revision: 3,
      addedStepIds: [],
      editedStepIds: [],
      deletedStepIds: [],
      reorderedStepIds: [],
      eligibleContacts: 0,
      completedParticipantsReceivingNewSteps: 0,
      validationErrors: [],
    };
    const targetErrors = [
      {
        url: "https://inside.example/materials/gone",
        targetId: null,
        reason: "not_found",
      },
    ];
    const result = await executeCommunications(previewSchema, "preview", () =>
      Promise.resolve({
        ok: true,
        body: {
          ok: true,
          value: {
            contractVersion: "inside-communications-v1",
            status: "ok",
            preview: value,
          },
          targetErrors,
        },
        response: new Response(),
      }),
    );
    expect(result).toEqual({
      kind: "ready",
      value: { ...value, targetErrors },
    });
  });
  it("blocks cross-origin publication at the actual capability BFF", async () => {
    const response = await handlePublishFunnel(
      publishRequest(
        { operationId: id, expectedRevision: 1, funnelId: id },
        "https://foreign.example",
      ),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
