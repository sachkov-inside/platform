import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { executeForm } from "../../src/_pages/communications/api/response.server";
import {
  saveFunnel,
  publishFunnel,
  resolveTemplate,
  retryDelivery,
  skipDelivery,
} from "../../src/_pages/communications/api/communications.browser";
import {
  commandSchema,
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
const id = "30800000-0000-4000-8000-000000000001";
const form = (input: unknown) => {
  const data = new FormData();
  data.set("input", JSON.stringify(input));
  return data;
};
describe("communications browser and presentation boundary", () => {
  it("preserves button rows while omitting an absent row from the provider shape", () => {
    const button = { text: "Open", url: "https://inside.test/material" };
    const content = contentSchema.parse({
      type: "text", text: "Post", entities: [],
      buttons: [{ ...button, row: undefined }, { ...button, row: 0 }, { ...button, row: 3 }],
    });
    expect(content.buttons).toEqual([button, { ...button, row: 0 }, { ...button, row: 3 }]);
    expect(content.buttons[0]).not.toHaveProperty("row");
    expect(contentSchema.safeParse({ ...content, buttons: [{ ...button, row: 20 }] }).success).toBe(false);
  });
  it("preserves operation identity and stale revision on repeated save without publishing", async () => {
    const draft = { ...newFunnel(), name: "Test" };
    draft.entryResponse.parts.push({
      partId: id,
      content: { type: "text", text: "Hello", entities: [], buttons: [] },
    });
    const fetcher = vi.fn(() =>
      Promise.resolve(
        Response.json({ kind: "ready", value: { ...draft, revision: 1 } }),
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const input = { draft, operationId: id, expectedRevision: 0 };
    await saveFunnel(input);
    await saveFunnel(input);
    expect(fetcher.mock.calls).toHaveLength(2);
    for (const [url, options] of fetcher.mock.calls as unknown as [
      string,
      RequestInit,
    ][]) {
      expect(url).toBe("/api/communications/funnels/save");
      expect(options.method).toBe("POST");
      expect(
        JSON.parse(z.string().parse((options.body as FormData).get("input"))),
      ).toEqual(input);
    }
  });
  it("keeps publish, template resolution, retry and skip on their own literal routes", async () => {
    const fetcher = vi.fn(() =>
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
    expect(
      fetcher.mock.calls.map((call) => (call as unknown as [string])[0]),
    ).toEqual([
      "/api/communications/funnels/publish",
      "/api/communications/templates/resolve",
      "/api/communications/deliveries/retry",
      "/api/communications/deliveries/skip",
    ]);
  });
  it("rejects an invalid command before transport and preserves conflict/unavailable/not-implemented outcomes", async () => {
    const request = vi.fn();
    expect(
      await executeForm(
        form({ funnelId: "bad" }),
        commandSchema,
        funnelSchema,
        "funnel",
        request,
      ),
    ).toEqual({ kind: "error", code: "invalid" });
    expect(request).not.toHaveBeenCalled();
    for (const [code, status, expected] of [
      ["revision_conflict", 409, "conflict"],
      ["provider_unavailable", 503, "unavailable"],
      ["not_implemented", 501, "not_implemented"],
      ["forbidden", 403, "forbidden"],
    ] as const) {
      expect(
        await executeForm(form({}), z.object({}), funnelSchema, "funnel", () =>
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
    const input = form({});
    expect(
      await executeForm(input, z.object({}), funnelSchema, "funnel", () =>
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
    const result = await executeForm(
      input,
      z.object({}),
      previewSchema,
      "preview",
      () =>
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
    const request = new Request(
      "https://inside.example/api/communications/funnels/publish",
      {
        method: "POST",
        headers: { origin: "https://foreign.example" },
        body: form({ operationId: id, expectedRevision: 1, funnelId: id }),
      },
    );
    const response = await handlePublishFunnel(request);
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
