import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  checkPassRequest,
  createPassFetch,
  PassRequestRejected,
} from "../production/pass-requests";

const web = "https://inside.sachkov.dev";
const logto = "https://auth.sachkov.dev";
const mcp = `${web}/mcp/learning`;

function toolCall(name: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: { slug: "closed" } },
  });
}

describe("production access pass request allowlist", () => {
  it.each([
    ["GET", `${web}/materials/closed`],
    ["GET", `${web}/api/materials/m/assets/a`],
    ["HEAD", `${web}/authoring/billing`],
    ["GET", "https://storage.example.test/signed?token=x"],
  ])("allows the read %s %s", (method, url) => {
    expect(checkPassRequest({ method, url })).toMatchObject({
      allowed: true,
      operation: "read",
    });
  });

  it.each([
    ["POST", `${web}/api/reading-progress/open`],
    ["PUT", `${web}/api/bookmarks/state`],
    ["PATCH", `${web}/api/authoring/materials`],
    ["DELETE", `${web}/api/bookmarks`],
    ["POST", `${web}/api/authoring/billing/tiers/list`],
    ["POST", `${web}/materials/closed`],
    ["POST", `${web}/auth/sign-out`],
    ["POST", "https://storage.example.test/upload"],
    ["GET", "http://inside.sachkov.dev/materials/closed"],
  ])("rejects the write %s %s", (method, url) => {
    expect(checkPassRequest({ method, url })).toMatchObject({
      allowed: false,
    });
  });

  it.each([
    ["GET", `${web}/communications/visit?token=x`],
    ["HEAD", `${web}/communications/visit?token=x`],
    ["GET", `${web}/communications/visit/?token=x`],
    ["GET", `${web}//communications//visit`],
    ["GET", `${web}/communications/%76isit?token=x`],
    ["GET", `${web}/%E0%A4%A`],
  ])("rejects %s %s that records a visit or hides its path", (method, url) => {
    expect(checkPassRequest({ method, url })).toMatchObject({
      allowed: false,
    });
  });

  it("allows learner MCP POST only to named read-only tools", () => {
    expect(
      checkPassRequest({
        method: "POST",
        url: mcp,
        body: toolCall("learning_material_read"),
      }),
    ).toMatchObject({ allowed: true, operation: "learner-mcp-read" });
    expect(
      checkPassRequest({
        method: "POST",
        url: mcp,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "inside-production-access-pass", version: "1" },
          },
        }),
      }),
    ).toMatchObject({ allowed: true, operation: "learner-mcp-read" });

    for (const body of [
      toolCall("practice_submission_create"),
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {},
      }),
      JSON.stringify([
        JSON.parse(toolCall("learning_material_read")) as unknown,
        JSON.parse(toolCall("practice_submission_create")) as unknown,
      ]),
      "not json",
      undefined,
    ])
      expect(
        checkPassRequest({ method: "POST", url: mcp, body }),
      ).toMatchObject({ allowed: false });
    expect(
      checkPassRequest({
        method: "POST",
        url: `${web}/mcp`,
        body: toolCall("learning_material_read"),
      }),
    ).toMatchObject({ allowed: false });
  });

  it("allows owner MCP POST only to its named read-only tools", () => {
    const ownerMcp = `${web}/mcp`;

    expect(
      checkPassRequest({
        method: "POST",
        url: ownerMcp,
        body: toolCall("billing_tiers_list"),
      }),
    ).toMatchObject({ allowed: true, operation: "owner-mcp-read" });
    for (const [url, tool] of [
      [ownerMcp, "billing_offers_save"],
      [ownerMcp, "billing_grants_apply_batch"],
      [mcp, "billing_tiers_list"],
    ] as const)
      expect(
        checkPassRequest({ method: "POST", url, body: toolCall(tool) }),
        `${url} ${tool}`,
      ).toMatchObject({ allowed: false });
  });

  it("allows the video playback session that only signs a token", () => {
    expect(
      checkPassRequest({
        method: "POST",
        url: `${web}/api/material-video-playback-sessions`,
        body: "{}",
      }),
    ).toMatchObject({ allowed: true, operation: "video-playback-read" });
    expect(
      checkPassRequest({
        method: "PUT",
        url: `${web}/api/material-video-progress`,
      }),
    ).toMatchObject({ allowed: false });
  });

  it("allows the Platform sign-in and the Logto one-time token sign-in", () => {
    for (const [method, url] of [
      ["POST", `${web}/auth/sign-in`],
      ["GET", `${web}/callback?code=x&state=y`],
      ["POST", `${logto}/api/experience/verification/one-time-token/verify`],
      ["POST", `${logto}/api/experience/identification`],
      ["POST", `${logto}/api/experience/submit`],
    ] as const)
      expect(
        checkPassRequest({ method, url }),
        `${method} ${url}`,
      ).toMatchObject({ allowed: true });
    expect(
      checkPassRequest({
        method: "PUT",
        url: `${logto}/api/experience`,
        body: JSON.stringify({ interactionEvent: "SignIn" }),
      }),
    ).toMatchObject({ allowed: true, operation: "logto-sign-in" });
    for (const body of [
      JSON.stringify({ interactionEvent: "Register" }),
      JSON.stringify({ interactionEvent: "ForgotPassword" }),
      undefined,
    ])
      expect(
        checkPassRequest({
          method: "PUT",
          url: `${logto}/api/experience`,
          body,
        }),
      ).toMatchObject({ allowed: false });

    for (const [method, url] of [
      ["POST", `${logto}/api/experience/profile`],
      ["PUT", `${logto}/api/experience/interaction-event`],
      ["POST", `${logto}/api/users`],
      ["PATCH", `${logto}/api/users/u1`],
    ] as const)
      expect(
        checkPassRequest({ method, url }),
        `${method} ${url}`,
      ).toMatchObject({ allowed: false });
  });

  it("allows only the pass identity operations of the Logto Management API", () => {
    for (const [method, url, body] of [
      [
        "POST",
        `${logto}/oidc/token`,
        "grant_type=client_credentials&resource=x",
      ],
      [
        "POST",
        `${logto}/oidc/token`,
        "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Atoken-exchange",
      ],
      ["GET", `${logto}/api/users?search=x`, undefined],
      ["POST", `${logto}/api/one-time-tokens`, "{}"],
      ["POST", `${logto}/api/users/u1/personal-access-tokens`, "{}"],
      [
        "DELETE",
        `${logto}/api/users/u1/personal-access-tokens/inside-production-access-42`,
        undefined,
      ],
    ] as const)
      expect(
        checkPassRequest({ method, url, body }),
        `${method} ${url}`,
      ).toMatchObject({ allowed: true });

    for (const [method, url, body] of [
      ["POST", `${logto}/oidc/token`, "grant_type=password"],
      [
        "DELETE",
        `${logto}/api/users/u1/personal-access-tokens/owner-token`,
        undefined,
      ],
      ["DELETE", `${logto}/api/users/u1`, undefined],
      ["POST", `${logto}/api/users/u1/roles`, "{}"],
    ] as const)
      expect(
        checkPassRequest({ method, url, body }),
        `${method} ${url}`,
      ).toMatchObject({ allowed: false });
  });
});

describe("production access pass fetch", () => {
  it("does not send a rejected request", async () => {
    const send = vi.fn<typeof fetch>();
    const passFetch = createPassFetch(send);

    await expect(
      passFetch(`${web}/api/bookmarks/state`, { method: "PUT", body: "{}" }),
    ).rejects.toBeInstanceOf(PassRequestRejected);
    expect(send).not.toHaveBeenCalled();
  });

  it("sends an allowed request without following redirects", async () => {
    const send = vi.fn<typeof fetch>(() => Promise.resolve(new Response("ok")));
    const passFetch = createPassFetch(send);

    await passFetch(mcp, {
      method: "POST",
      body: toolCall("learning_material_read"),
    });
    await passFetch(`${web}/materials/closed`);

    expect(send.mock.calls.map(([, init]) => init?.redirect)).toEqual([
      "manual",
      "manual",
    ]);
  });

  it("retries a dropped read with a fresh timeout after a pause", async () => {
    vi.useFakeTimers();
    try {
      const send = vi
        .fn<typeof fetch>()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(new Response("ok"));
      const read = createPassFetch(send)(`${web}/materials/closed`);

      await vi.advanceTimersByTimeAsync(3_000);
      await read;

      const [first, second] = send.mock.calls.map(([, init]) => init?.signal);
      expect(send).toHaveBeenCalledTimes(2);
      expect(first).toBeInstanceOf(AbortSignal);
      expect(second).toBeInstanceOf(AbortSignal);
      expect(second).not.toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry a dropped write", async () => {
    const send = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      createPassFetch(send)(`${logto}/api/one-time-tokens`, {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow("fetch failed");
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("production access pass sources", () => {
  it("send requests only through the allowlist", () => {
    const directory = fileURLToPath(new URL("../production/", import.meta.url));
    const bypasses = readdirSync(directory)
      .filter((name) => name.endsWith(".ts") && name !== "pass-requests.ts")
      .flatMap((name) => {
        const source = readFileSync(`${directory}${name}`, "utf8");
        return [/(?<![\w.])fetch\(/u, /\.request\./u, /\brequest\.newContext/u]
          .filter((pattern) => pattern.test(source))
          .map((pattern) => `${name}: ${pattern.source}`);
      });

    expect(bypasses).toEqual([]);
  });
});
