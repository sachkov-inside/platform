import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPrivateAccountProfile } from "@/_pages/account/api/get-private-account-profile";
import { getAccountTelegramMembership } from "@/_pages/account/api/get-account-telegram-membership";
import { beginTelegramLink } from "@/features/account-access/api/begin-telegram-link.browser";
import { confirmTelegramLink } from "@/features/account-access/api/confirm-telegram-link.browser";
import { confirmTelegramLinkOperation } from "@/features/account-access.operations";
import { createAccountProfileInputSchema } from "@/features/account-profile-editor.operations";
import { requestAccountPresentation } from "@/features/account-access/api/request-account-presentation";
import { accountPresentationQueryKey } from "@/features/account-access";
import {
  executeBeginTelegramLink,
  executeConfirmTelegramLink,
  executeCreateAccountProfile,
  invalidCreateProfileFields,
  invalidTelegramLinkInput,
  executeUpdateAccountProfile,
} from "@/_pages/account.operations.server";
import {
  profileInitials,
  shouldUseAvatarImage,
} from "@/entities/account-profile";

import * as accountRoute from "../../app/api/account/route";
import * as beginRoute from "../../app/api/account/telegram-link/begin/route";
import * as confirmRoute from "../../app/api/account/telegram-link/confirm/route";
import { realBffSession } from "../support/real-bff-session";
import { interceptBackendHttp } from "../support/backend-http";
import { routeBrowserMutations } from "../support/mutation-operation-route";

interface BackendReply {
  readonly method: string;
  readonly path: string;
  readonly response: Response;
  request?: Request;
}
let replies: BackendReply[];
let scope: Awaited<ReturnType<typeof realBffSession>>;
const backend = vi.fn<(request: Request) => Promise<Response>>();
beforeEach(async () => {
  vi.setSystemTime(new Date("2026-11-16T12:00:00.000Z"));
  scope = await realBffSession("access-token");
  replies = [];
  backend.mockReset();
  backend.mockImplementation((request) => {
    const reply = replies.find(
      (candidate) =>
        candidate.request === undefined &&
        candidate.method === request.method &&
        request.url === `https://platform-api.example.test${candidate.path}`,
    );
    if (reply !== undefined) reply.request = request;
    return reply === undefined
      ? Promise.reject(new Error("Unexpected external request"))
      : Promise.resolve(reply.response);
  });
  interceptBackendHttp(backend);
});
afterEach(() => {
  try {
    expect(backend).toHaveBeenCalledTimes(replies.length);
    replies.forEach((reply) => {
      const request = reply.request;
      if (request === undefined) throw new Error("Expected backend request");
      expect(request.method).toBe(reply.method);
      expect(request.url).toBe(
        `https://platform-api.example.test${reply.path}`,
      );
      expect(request.headers.get("authorization")).toBe("Bearer access-token");
      if (reply.method === "GET") expect(request.body).toBeNull();
    });
  } finally {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
function respond(method: string, path: string, body: unknown, status = 200) {
  replies.push({ method, path, response: Response.json(body, { status }) });
}
async function requestBody(index = 0) {
  const request = backend.mock.calls[index]?.[0];
  if (request === undefined) throw new Error("Expected backend request");
  return request.json() as Promise<unknown>;
}
function connectBrowser() {
  return routeBrowserMutations(
    {
      "/api/account": accountRoute,
      "/api/account/telegram-link/begin": beginRoute,
      "/api/account/telegram-link/confirm": confirmRoute,
    },
    undefined,
    { externalFetch: backend, run: scope },
  );
}

const profile = {
  avatar: null,
  bio: "Строю платформу.",
  createdAt: "2026-08-30T10:00:00.000Z",
  displayName: "Кирилл",
  status: "active",
  updatedAt: "2026-08-30T10:00:00.000Z",
  version: 2 as const,
} as const;

describe("Account Profile web workflow", () => {
  it("derives deterministic Unicode initials for the avatar fallback", () => {
    expect(profileInitials("  Кирилл   Сачков ")).toBe("КС");
    expect(profileInitials("Prince")).toBe("P");
    expect(profileInitials("🙂 Emoji")).toBe("🙂E");
    expect(profileInitials("  ")).toBe("SI");
  });

  it("retries image delivery when a failed avatar is replaced", () => {
    const oldUrl = "/avatar/old/320";
    const newUrl = "/avatar/new/320";
    expect(shouldUseAvatarImage(oldUrl, null)).toBe(true);
    expect(shouldUseAvatarImage(oldUrl, oldUrl)).toBe(false);
    expect(shouldUseAvatarImage(newUrl, oldUrl)).toBe(true);
  });
  it("creates an accepted Profile and keeps an empty bio nullable", async () => {
    respond("POST", "/account/profile", { profile }, 201);
    const formData = { displayName: "Кирилл", bio: "  " };

    await expect(
      executeCreateAccountProfile(formData, "access-token"),
    ).resolves.toEqual({ kind: "saved", profile });
    expect(await requestBody()).toEqual({ bio: null, displayName: "Кирилл" });
  });

  it("validates the composite Account presentation BFF payload", async () => {
    expect(accountPresentationQueryKey()).toEqual(["account", "presentation"]);
    respond("GET", "/account/profile", { kind: "missing" });
    respond("GET", "/accounts/current/telegram-membership", {
      link: { kind: "unlinked" },
      membership: { kind: "inactive" },
    });
    const browser = connectBrowser();
    await expect(
      requestAccountPresentation(new AbortController().signal),
    ).resolves.toEqual({
      kind: "ready",
      presentation: {
        profile: { kind: "missing" },
        telegramMembership: {
          link: { kind: "unlinked" },
          membership: { kind: "inactive" },
        },
      },
    });
    expect(browser.requests).toHaveLength(1);
    expect(browser.requests[0]?.url).toBe(
      "https://inside.example.test/api/account",
    );
    expect(browser.requests[0]?.cache).toBe("no-store");
    expect(browser.statuses).toEqual([200]);
  });

  it("accepts a cabinet where the subscription is not on sale", async () => {
    respond("GET", "/account/profile", { kind: "missing" });
    respond("GET", "/accounts/current/telegram-membership", {
      link: { kind: "unlinked" },
      membership: { kind: "notOffered" },
    });
    const browser = connectBrowser();
    await expect(
      requestAccountPresentation(new AbortController().signal),
    ).resolves.toMatchObject({
      kind: "ready",
      presentation: {
        telegramMembership: { membership: { kind: "notOffered" } },
      },
    });
    expect(browser.requests).toHaveLength(1);
    expect(browser.requests[0]?.url).toBe(
      "https://inside.example.test/api/account",
    );
    expect(browser.statuses).toEqual([200]);
  });

  it("maps only the private coarse Telegram and Membership presentation", async () => {
    respond("GET", "/accounts/current/telegram-membership", {
      link: { kind: "linked" },
      membership: { kind: "active" },
    });
    await expect(getAccountTelegramMembership("access-token")).resolves.toEqual(
      {
        kind: "ready",
        presentation: {
          link: { kind: "linked" },
          membership: { kind: "active" },
        },
      },
    );
    expect(backend).toHaveBeenCalledTimes(1);

    respond("GET", "/accounts/current/telegram-membership", {
      accountId: "72000000-0000-4000-8000-000000000001",
      link: { kind: "linked", telegramUsername: "inside" },
      membership: {
        checkedAt: "2030-01-01T00:00:00.000Z",
        kind: "active",
      },
    });
    await expect(getAccountTelegramMembership("access-token")).resolves.toEqual(
      {
        kind: "unavailable",
        reference: "telegram-membership-contract",
      },
    );

    respond("GET", "/accounts/current/telegram-membership", {
      link: { kind: "conflict", supportUrl: "javascript:alert(1)" },
      membership: { kind: "active" },
    });
    await expect(getAccountTelegramMembership("access-token")).resolves.toEqual(
      {
        kind: "unavailable",
        reference: "telegram-membership-contract",
      },
    );
  });

  it("keeps begin and confirm as separate typed Account mutations", async () => {
    respond("POST", "/accounts/current/telegram-link", {
      deepLink: "https://t.me/inside_test_bot?start=opaque",
      expiresAt: "2030-01-01T00:05:00.000Z",
      linkRef: "62000000-0000-4000-8000-000000000001",
      status: "pending",
    });
    await expect(
      executeBeginTelegramLink("access-token"),
    ).resolves.toMatchObject({
      kind: "received",
      state: { status: "pending" },
    });
    expect(backend).toHaveBeenCalledTimes(1);

    respond(
      "POST",
      "/accounts/current/telegram-link/62000000-0000-4000-8000-000000000001/confirm",
      {
        expiresAt: "2030-01-01T00:05:00.000Z",
        linkRef: "62000000-0000-4000-8000-000000000001",
        status: "linked",
      },
    );
    const confirmation = { linkRef: "62000000-0000-4000-8000-000000000001" };
    await expect(
      executeConfirmTelegramLink(confirmation, "access-token"),
    ).resolves.toMatchObject({
      kind: "received",
      state: { status: "linked" },
    });
    expect(backend).toHaveBeenCalledTimes(2);

    expect(
      confirmTelegramLinkOperation.input.safeParse({
        linkRef: "raw-telegram-id",
      }).success,
    ).toBe(false);
    expect(invalidTelegramLinkInput()).toEqual({
      kind: "unavailable",
      reference: "telegram-link-input",
    });
    expect(backend).toHaveBeenCalledTimes(2);
  });

  it("uses literal same-origin routes for begin and confirm", async () => {
    respond("POST", "/accounts/current/telegram-link", {
      expiresAt: "2030-01-01T00:05:00.000Z",
      linkRef: "62000000-0000-4000-8000-000000000001",
      status: "pending",
    });
    respond(
      "POST",
      "/accounts/current/telegram-link/62000000-0000-4000-8000-000000000001/confirm",
      {
        expiresAt: "2030-01-01T00:05:00.000Z",
        linkRef: "62000000-0000-4000-8000-000000000001",
        status: "linked",
      },
    );
    const browser = connectBrowser();
    await expect(beginTelegramLink()).resolves.toMatchObject({
      kind: "received",
      state: { status: "pending" },
    });
    await expect(
      confirmTelegramLink("62000000-0000-4000-8000-000000000001"),
    ).resolves.toMatchObject({ kind: "received", state: { status: "linked" } });
    expect(browser.requests.map((r) => [r.method, r.url])).toEqual([
      ["POST", "https://inside.example.test/api/account/telegram-link/begin"],
      ["POST", "https://inside.example.test/api/account/telegram-link/confirm"],
    ]);
    expect(browser.statuses).toEqual([200, 200]);
    expect(await browser.requests[1]?.json()).toEqual({
      linkRef: "62000000-0000-4000-8000-000000000001",
    });
  });

  it("rejects malformed fields before calling the backend", () => {
    const parsed = createAccountProfileInputSchema.safeParse({
      displayName: "К",
      bio: "",
    });
    if (parsed.success) throw new Error("A one-letter name must be rejected");

    const result = invalidCreateProfileFields(parsed.error);
    expect(result.kind).toBe("invalid_input");
    expect(
      result.kind === "invalid_input"
        ? typeof result.fieldErrors.displayName
        : "missing",
    ).toBe("string");
    expect(backend).not.toHaveBeenCalled();
  });

  it("counts authored fields by Unicode code point", async () => {
    respond("POST", "/account/profile", { profile }, 201);
    const formData = createAccountProfileInputSchema.parse({
      displayName: "🙂".repeat(80),
      bio: "🙂".repeat(500),
    });

    await expect(
      executeCreateAccountProfile(formData, "access-token"),
    ).resolves.toMatchObject({ kind: "saved" });
    expect(await requestBody()).toEqual({
      bio: "🙂".repeat(500),
      displayName: "🙂".repeat(80),
    });
  });

  it("maps field-level backend validation and stale-version conflicts", async () => {
    respond(
      "PUT",
      "/account/profile",
      {
        code: "invalid_input",
        issues: [{ code: "too_long", field: "bio" }],
        status: 422,
      },
      422,
    );
    await expect(
      executeUpdateAccountProfile(updateForm(), "access-token"),
    ).resolves.toEqual({
      fieldErrors: { bio: "Описание должно быть не длиннее 500 символов." },
      kind: "invalid_input",
    });

    respond(
      "PUT",
      "/account/profile",
      { code: "conflict", currentVersion: 4, status: 409 },
      409,
    );
    await expect(
      executeUpdateAccountProfile(updateForm(), "access-token"),
    ).resolves.toEqual({ currentVersion: 4, kind: "conflict" });
  });

  it("maps the private missing state", async () => {
    respond("GET", "/account/profile", { kind: "missing" });
    await expect(getPrivateAccountProfile("access-token")).resolves.toEqual({
      kind: "ready",
      state: { kind: "missing" },
    });
  });
});

function updateForm() {
  return { displayName: "Кирилл", bio: "Строю платформу.", expectedVersion: 2 };
}
