import { describe, expect, test } from "vitest";

import {
  memberProfileProjection,
  privateProfileProjection,
} from "../../src/modules/member-profiles/shared/profile-projection.js";

const storedProfile = {
  avatarId: "50000000-0000-4000-8000-000000000001",
  bio: null,
  createdAt: new Date("2026-09-01T10:00:00.000Z"),
  displayName: "Кирилл",
  publicProfileId: "40000000-0000-4000-8000-000000000001",
  status: "active",
  updatedAt: new Date("2026-09-01T10:00:00.000Z"),
  version: 2,
};

describe("Member Profile persistence projection", () => {
  test("accepts checked Profile and Avatar identifiers", () => {
    expect(privateProfileProjection(storedProfile)).toMatchObject({
      avatar: { avatarId: storedProfile.avatarId },
      publicProfileId: storedProfile.publicProfileId,
    });
    expect(memberProfileProjection(storedProfile)).toMatchObject({
      avatar: { avatarId: storedProfile.avatarId },
      publicProfileId: storedProfile.publicProfileId,
    });
  });

  test("fails closed for an invalid persisted Avatar identifier", () => {
    const invalid = { ...storedProfile, avatarId: "not-a-profile-avatar-id" };

    expect(privateProfileProjection(invalid)).toBeNull();
    expect(memberProfileProjection(invalid)).toBeNull();
  });
});
