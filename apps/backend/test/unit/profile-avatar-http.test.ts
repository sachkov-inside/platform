import type { MultipartFile } from "@fastify/multipart";
import { HttpException } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { describe, expect, test, vi } from "vitest";

import {
  PrivateProfileAvatarController,
  ProfileAvatarDeliveryController,
} from "../../src/modules/member-profiles/adapters/nest/profile-avatar.controller.js";
import type { MemberProfiles } from "../../src/modules/member-profiles/index.js";

const account = { accountId: "30000000-0000-4000-8000-000000000001" };
const publicProfileId = "40000000-0000-4000-8000-000000000001";
const avatarId = "50000000-0000-4000-8000-000000000001";

describe("Profile Avatar HTTP controllers", () => {
  test("maps malformed and oversized multipart input before application dispatch", async () => {
    const changeAvatar = vi.fn<MemberProfiles["changeAvatar"]>();
    const controller = new PrivateProfileAvatarController(
      memberProfiles({ changeAvatar }),
    );

    await expectHttpProblem(
      controller.upload(account, missingFileRequest()),
      422,
      "invalid_avatar",
    );
    await expectHttpProblem(
      controller.upload(account, multipartRequest({ truncated: true })),
      413,
      "image_too_large",
    );
    expect(changeAvatar).not.toHaveBeenCalled();
  });

  test("maps rejected image metadata to 422 and image size mismatch to 413", async () => {
    const invalidController = new PrivateProfileAvatarController(
      memberProfiles({
        changeAvatar: vi
          .fn<MemberProfiles["changeAvatar"]>()
          .mockResolvedValue({
            error: { code: "invalid_avatar", reason: "unsupported_image_type" },
            ok: false,
          }),
      }),
    );
    await expectHttpProblem(
      invalidController.upload(account, multipartRequest()),
      422,
      "invalid_avatar",
    );

    const oversizedController = new PrivateProfileAvatarController(
      memberProfiles({
        changeAvatar: vi
          .fn<MemberProfiles["changeAvatar"]>()
          .mockResolvedValue({
            error: { code: "invalid_avatar", reason: "size_mismatch" },
            ok: false,
          }),
      }),
    );
    await expectHttpProblem(
      oversizedController.upload(account, multipartRequest()),
      413,
      "invalid_avatar",
    );
  });

  test("maps optimistic conflicts and dependency failures for avatar removal", async () => {
    const conflictController = new PrivateProfileAvatarController(
      memberProfiles({
        changeAvatar: vi
          .fn<MemberProfiles["changeAvatar"]>()
          .mockResolvedValue({
            error: { code: "conflict", currentVersion: 7 },
            ok: false,
          }),
      }),
    );
    await expectHttpProblem(
      conflictController.remove(account, { expectedVersion: 6 }),
      409,
      "conflict",
    );

    const unavailableController = new PrivateProfileAvatarController(
      memberProfiles({
        changeAvatar: vi
          .fn<MemberProfiles["changeAvatar"]>()
          .mockResolvedValue({
            error: { code: "dependency_unavailable" },
            ok: false,
          }),
      }),
    );
    await expectHttpProblem(
      unavailableController.remove(account, { expectedVersion: 6 }),
      503,
      "dependency_unavailable",
    );
  });

  test("masks invalid, anonymous, and unavailable delivery while returning redirects", async () => {
    const deliverAvatar = vi
      .fn<MemberProfiles["deliverAvatar"]>()
      .mockResolvedValueOnce({ error: { code: "not_found" }, ok: false })
      .mockResolvedValueOnce({
        error: { code: "dependency_unavailable" },
        ok: false,
      })
      .mockResolvedValueOnce({
        location: "https://storage.example.test/protected-avatar",
        ok: true,
      });
    const controller = new ProfileAvatarDeliveryController(
      memberProfiles({ deliverAvatar }),
    );

    await expectHttpProblem(
      controller.read(undefined, publicProfileId, avatarId, "320"),
      404,
      "profile_not_found",
    );
    await expectHttpProblem(
      controller.read(account, "not-a-uuid", avatarId, "320"),
      404,
      "profile_not_found",
    );
    await expectHttpProblem(
      controller.read(account, publicProfileId, avatarId, "320"),
      404,
      "profile_not_found",
    );
    await expectHttpProblem(
      controller.read(account, publicProfileId, avatarId, "320"),
      503,
      "dependency_unavailable",
    );
    await expect(
      controller.read(account, publicProfileId, avatarId, "320"),
    ).resolves.toEqual({
      cacheScope: "private-no-store",
      kind: "redirect",
      location: "https://storage.example.test/protected-avatar",
    });
    expect(deliverAvatar).toHaveBeenCalledTimes(3);
  });
});

function memberProfiles(overrides: Partial<MemberProfiles>): MemberProfiles {
  return {
    changeAvatar: vi.fn<MemberProfiles["changeAvatar"]>(),
    createProfile: vi.fn<MemberProfiles["createProfile"]>(),
    deliverAvatar: vi.fn<MemberProfiles["deliverAvatar"]>(),
    readPrivateProfile: vi.fn<MemberProfiles["readPrivateProfile"]>(),
    updateProfile: vi.fn<MemberProfiles["updateProfile"]>(),
    viewProfile: vi.fn<MemberProfiles["viewProfile"]>(),
    ...overrides,
  };
}

function missingFileRequest(): FastifyRequest {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The controller reads only request.file from this transport fixture.
  return { file: vi.fn().mockResolvedValue(undefined) } as unknown as FastifyRequest;
}

function multipartRequest(options: { readonly truncated?: boolean } = {}): FastifyRequest {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The controller reads only this tested MultipartFile subset.
  const part = {
    fields: {
      checksumSha256: { type: "field", value: "a".repeat(64) },
      crop: {
        type: "field",
        value: JSON.stringify({ centerX: 0.5, centerY: 0.5, zoom: 1 }),
      },
      declaredSize: { type: "field", value: "3" },
      expectedVersion: { type: "field", value: "2" },
    },
    file: { truncated: options.truncated ?? false },
    mimetype: "image/png",
    toBuffer: () => Promise.resolve(Buffer.from("png")),
  } as unknown as MultipartFile;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The controller reads only request.file from this transport fixture.
  return { file: vi.fn().mockResolvedValue(part) } as unknown as FastifyRequest;
}

async function expectHttpProblem(
  promise: unknown,
  status: number,
  code: string,
): Promise<void> {
  try {
    await promise;
    throw new Error("Expected an HTTP problem");
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    if (!(error instanceof HttpException)) throw error;
    expect(error.getStatus()).toBe(status);
    expect(error.getResponse()).toMatchObject({ code, status });
  }
}
