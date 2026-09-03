import { describe, expect, it, vi } from "vitest";

import { getPrivateMemberProfile } from "@/_pages/account/api/get-private-member-profile";
import { getAccountTelegramMembership } from "@/_pages/account/api/get-account-telegram-membership";
import { beginTelegramLink } from "@/features/account-access/api/begin-telegram-link.browser";
import { confirmTelegramLink } from "@/features/account-access/api/confirm-telegram-link.browser";
import { requestAccountPresentation } from "@/features/account-access/api/request-account-presentation";
import { accountPresentationQueryKey } from "@/features/account-access";
import {
  executeBeginTelegramLink,
  executeConfirmTelegramLink,
  executeCreateMemberProfile,
  executeUpdateMemberProfile,
} from "@/_pages/account.operations.server";
import { getMemberProfile } from "@/_pages/member-profile/api/get-member-profile";
import {
  profileInitials,
  shouldUseAvatarImage,
} from "@/entities/member-profile";

const publicProfileId = "d3acb421-85e2-4c79-9dfa-4b2c925e56e8";
const profile = {
  avatar: null,
  bio: "Строю платформу.",
  createdAt: "2026-08-30T10:00:00.000Z",
  displayName: "Кирилл",
  publicProfileId,
  status: "active",
  updatedAt: "2026-08-30T10:00:00.000Z",
  version: 2,
} as const;

describe("Member Profile web workflow", () => {
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
    const dependencies = successfulDependencies();
    const formData = new FormData();
    formData.set("displayName", "Кирилл");
    formData.set("bio", "  ");

    await expect(
      executeCreateMemberProfile(formData, "access-token", dependencies.create),
    ).resolves.toEqual({ kind: "saved", profile });
    expect(dependencies.create).toHaveBeenCalledWith(
      { bio: null, displayName: "Кирилл" },
      "access-token",
    );
  });

  it("validates the composite Account presentation BFF payload", async () => {
    expect(accountPresentationQueryKey()).toEqual(["account", "presentation"]);
    const fetch = vi.fn().mockResolvedValue(
      Response.json(
        {
          profile: { kind: "missing" },
          telegramMembership: {
            link: { kind: "unlinked" },
            membership: {
              acquisitionUrl: "https://t.me/tribute/inside",
              kind: "inactive",
            },
          },
        },
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        requestAccountPresentation(new AbortController().signal),
      ).resolves.toEqual({
        kind: "ready",
        presentation: {
          profile: { kind: "missing" },
          telegramMembership: {
            link: { kind: "unlinked" },
            membership: {
              acquisitionUrl: "https://t.me/tribute/inside",
              kind: "inactive",
            },
          },
        },
      });
      expect(fetch).toHaveBeenCalledWith(
        "/api/account",
        expect.objectContaining({ cache: "no-store" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("maps only the private coarse Telegram and Membership presentation", async () => {
    const request = vi.fn().mockResolvedValue({
      body: {
        link: { kind: "linked" },
        membership: { kind: "active" },
      },
      ok: true,
      response: Response.json({}),
    });
    await expect(
      getAccountTelegramMembership("access-token", request),
    ).resolves.toEqual({
      kind: "ready",
      presentation: {
        link: { kind: "linked" },
        membership: { kind: "active" },
      },
    });
    expect(request).toHaveBeenCalledWith("access-token");

    const malformed = vi.fn().mockResolvedValue({
      body: {
        accountId: "72000000-0000-4000-8000-000000000001",
        link: { kind: "linked", telegramUsername: "inside" },
        membership: {
          checkedAt: "2030-01-01T00:00:00.000Z",
          kind: "active",
        },
      },
      ok: true,
      response: Response.json({}),
    });
    await expect(
      getAccountTelegramMembership("access-token", malformed),
    ).resolves.toEqual({
      kind: "unavailable",
      reference: "telegram-membership-contract",
    });

    const unsafeLink = vi.fn().mockResolvedValue({
      body: {
        link: { kind: "conflict", supportUrl: "javascript:alert(1)" },
        membership: { kind: "active" },
      },
      ok: true,
      response: Response.json({}),
    });
    await expect(
      getAccountTelegramMembership("access-token", unsafeLink),
    ).resolves.toEqual({
      kind: "unavailable",
      reference: "telegram-membership-contract",
    });
  });

  it("keeps begin and confirm as separate typed Account mutations", async () => {
    const beginRequest = vi.fn().mockResolvedValue({
      body: {
        deepLink: "https://t.me/inside_test_bot?start=opaque",
        expiresAt: "2030-01-01T00:05:00.000Z",
        linkRef: "62000000-0000-4000-8000-000000000001",
        status: "pending",
      },
      ok: true,
      response: Response.json({}),
    });
    await expect(
      executeBeginTelegramLink(new FormData(), "access-token", beginRequest),
    ).resolves.toMatchObject({
      kind: "received",
      state: { status: "pending" },
    });
    expect(beginRequest).toHaveBeenCalledWith("access-token");

    const confirmRequest = vi.fn().mockResolvedValue({
      body: {
        expiresAt: "2030-01-01T00:05:00.000Z",
        linkRef: "62000000-0000-4000-8000-000000000001",
        status: "linked",
      },
      ok: true,
      response: Response.json({}),
    });
    const confirmation = new FormData();
    confirmation.set("linkRef", "62000000-0000-4000-8000-000000000001");
    await expect(
      executeConfirmTelegramLink(
        confirmation,
        "access-token",
        confirmRequest,
      ),
    ).resolves.toMatchObject({
      kind: "received",
      state: { status: "linked" },
    });
    expect(confirmRequest).toHaveBeenCalledWith(
      "62000000-0000-4000-8000-000000000001",
      "access-token",
    );

    const invalid = new FormData();
    invalid.set("linkRef", "raw-telegram-id");
    await expect(
      executeConfirmTelegramLink(invalid, "access-token", confirmRequest),
    ).resolves.toEqual({
      kind: "unavailable",
      reference: "telegram-link-input",
    });
    expect(confirmRequest).toHaveBeenCalledTimes(1);
  });

  it("uses literal same-origin routes for begin and confirm", async () => {
    const fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(
        Response.json({
          kind: "received",
          state: {
            expiresAt: "2030-01-01T00:05:00.000Z",
            linkRef: "62000000-0000-4000-8000-000000000001",
            status: url.endsWith("/begin") ? "pending" : "linked",
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      await beginTelegramLink();
      await confirmTelegramLink("62000000-0000-4000-8000-000000000001");
      expect(fetch).toHaveBeenNthCalledWith(
        1,
        "/api/account/telegram-link/begin",
        expect.objectContaining({ method: "POST" }),
      );
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "/api/account/telegram-link/confirm",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects malformed fields before calling the backend", async () => {
    const dependencies = successfulDependencies();
    const formData = new FormData();
    formData.set("displayName", "К");
    formData.set("bio", "");

    const result = await executeCreateMemberProfile(
      formData,
      "access-token",
      dependencies.create,
    );
    expect(result.kind).toBe("invalid_input");
    expect(
      result.kind === "invalid_input"
        ? typeof result.fieldErrors.displayName
        : "missing",
    ).toBe("string");
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it("counts authored fields by Unicode code point", async () => {
    const dependencies = successfulDependencies();
    const formData = new FormData();
    formData.set("displayName", "🙂".repeat(80));
    formData.set("bio", "🙂".repeat(500));

    await expect(
      executeCreateMemberProfile(formData, "access-token", dependencies.create),
    ).resolves.toMatchObject({ kind: "saved" });
    expect(dependencies.create).toHaveBeenCalledWith(
      { bio: "🙂".repeat(500), displayName: "🙂".repeat(80) },
      "access-token",
    );
  });

  it("maps field-level backend validation and stale-version conflicts", async () => {
    const invalidDependencies = {
      ...successfulDependencies(),
      update: vi.fn().mockResolvedValue({
        ok: false,
        problem: {
          code: "invalid_input",
          issues: [{ code: "too_long", field: "bio" }],
          status: 422,
        },
        response: Response.json({}, { status: 422 }),
      }),
    };
    await expect(
      executeUpdateMemberProfile(
        updateForm(),
        "access-token",
        invalidDependencies.update,
      ),
    ).resolves.toEqual({
      fieldErrors: { bio: "Описание должно быть не длиннее 500 символов." },
      kind: "invalid_input",
    });

    const conflictDependencies = {
      ...successfulDependencies(),
      update: vi.fn().mockResolvedValue({
        ok: false,
        problem: { code: "conflict", currentVersion: 4, status: 409 },
        response: Response.json({}, { status: 409 }),
      }),
    };
    await expect(
      executeUpdateMemberProfile(
        updateForm(),
        "access-token",
        conflictDependencies.update,
      ),
    ).resolves.toEqual({ currentVersion: 4, kind: "conflict" });
  });

  it("maps private missing state and fails closed for member projection", async () => {
    await expect(
      getPrivateMemberProfile(
        "access-token",
        vi.fn().mockResolvedValue({
          body: { kind: "missing" },
          ok: true,
          response: Response.json({}),
        }),
      ),
    ).resolves.toEqual({ kind: "ready", state: { kind: "missing" } });

    await expect(
      getMemberProfile(
        publicProfileId,
        undefined,
        vi.fn().mockResolvedValue({
          ok: false,
          problem: { code: "profile_not_found" },
          response: Response.json({}, { status: 404 }),
        }),
      ),
    ).resolves.toEqual({ kind: "not_found" });
    await expect(
      getMemberProfile(
        publicProfileId,
        "access-token",
        vi.fn().mockResolvedValue({
          ok: false,
          problem: {
            code: "internal_error",
            correlationId: "profile-ref",
            status: 500,
          },
          response: Response.json({}, { status: 500 }),
        }),
      ),
    ).resolves.toEqual({ kind: "unavailable", reference: "profile-ref" });
    await expect(
      getMemberProfile(
        publicProfileId,
        "access-token",
        vi.fn().mockResolvedValue({
          body: {
            profile: {
              avatar: null,
              bio: profile.bio,
              displayName: profile.displayName,
              publicProfileId,
            },
          },
          ok: true,
          response: Response.json({}),
        }),
      ),
    ).resolves.toMatchObject({ kind: "ready", profile: { publicProfileId } });
  });
});

function successfulDependencies() {
  return {
    create: vi.fn().mockResolvedValue({
      body: { profile },
      ok: true,
      response: Response.json({}),
    }),
    update: vi.fn().mockResolvedValue({
      body: { profile },
      ok: true,
      response: Response.json({}),
    }),
  };
}

function updateForm(): FormData {
  const formData = new FormData();
  formData.set("displayName", "Кирилл");
  formData.set("bio", "Строю платформу.");
  formData.set("expectedVersion", "2");
  return formData;
}
