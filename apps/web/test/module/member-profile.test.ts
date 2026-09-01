import { describe, expect, it, vi } from "vitest";

import { getPrivateMemberProfile } from "@/_pages/account/api/get-private-member-profile";
import { requestAccountProfile } from "@/_pages/account/api/request-account-profile";
import { accountProfileQueryKey } from "@/_pages/account/model/account-profile-query";
import {
  executeSaveMemberProfile,
  type ProfileMutationDependencies,
} from "@/_pages/account/api/mutate-member-profile";
import { getMemberProfile } from "@/_pages/member-profile/api/get-member-profile";

const publicProfileId = "d3acb421-85e2-4c79-9dfa-4b2c925e56e8";
const profile = {
  bio: "Строю платформу.",
  createdAt: "2026-08-30T10:00:00.000Z",
  displayName: "Кирилл",
  publicProfileId,
  status: "active",
  updatedAt: "2026-08-30T10:00:00.000Z",
  version: 2,
} as const;

describe("Member Profile web workflow", () => {
  it("creates an accepted Profile and keeps an empty bio nullable", async () => {
    const dependencies = successfulDependencies();
    const formData = new FormData();
    formData.set("mode", "create");
    formData.set("displayName", "Кирилл");
    formData.set("bio", "  ");

    await expect(
      executeSaveMemberProfile(formData, "access-token", dependencies),
    ).resolves.toEqual({ kind: "saved", profile });
    expect(dependencies.create).toHaveBeenCalledWith(
      { bio: null, displayName: "Кирилл" },
      "access-token",
    );
  });

  it("keeps one Account Profile query identity and validates the BFF payload", async () => {
    expect(accountProfileQueryKey()).toEqual(["account", "profile"]);
    const fetch = vi.fn().mockResolvedValue(
      Response.json({ kind: "missing" }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      await expect(
        requestAccountProfile(new AbortController().signal),
      ).resolves.toEqual({ kind: "ready", state: { kind: "missing" } });
      expect(fetch).toHaveBeenCalledWith(
        "/api/account/profile",
        expect.objectContaining({ cache: "no-store" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects malformed fields before calling the backend", async () => {
    const dependencies = successfulDependencies();
    const formData = new FormData();
    formData.set("mode", "create");
    formData.set("displayName", "К");
    formData.set("bio", "");

    const result = await executeSaveMemberProfile(
      formData,
      "access-token",
      dependencies,
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
    formData.set("mode", "create");
    formData.set("displayName", "🙂".repeat(80));
    formData.set("bio", "🙂".repeat(500));

    await expect(
      executeSaveMemberProfile(formData, "access-token", dependencies),
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
    } satisfies ProfileMutationDependencies;
    await expect(
      executeSaveMemberProfile(updateForm(), "access-token", invalidDependencies),
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
    } satisfies ProfileMutationDependencies;
    await expect(
      executeSaveMemberProfile(updateForm(), "access-token", conflictDependencies),
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

function successfulDependencies(): ProfileMutationDependencies {
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
  formData.set("mode", "update");
  formData.set("displayName", "Кирилл");
  formData.set("bio", "Строю платформу.");
  formData.set("expectedVersion", "2");
  return formData;
}
