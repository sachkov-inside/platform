import { describe, expect, test } from "vitest";

import { privateProfileProjection } from "../../src/modules/member-profiles/shared/profile-projection.js";

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
    const projection = privateProfileProjection(storedProfile);
    expect(projection).toMatchObject({
      avatar: { avatarId: storedProfile.avatarId },
    });
    // The owner's Profile carries no address for other members.
    expect(projection).not.toHaveProperty("publicProfileId");
  });

  test("fails closed for an invalid persisted Avatar identifier", () => {
    const invalid = { ...storedProfile, avatarId: "not-a-profile-avatar-id" };

    expect(privateProfileProjection(invalid)).toBeNull();
  });
});
