import { describe, expect, test } from "vitest";

import { acceptMemberProfileFields } from "../../src/modules/member-profiles/domain/profile-fields.js";

describe("Member Profile fields", () => {
  test("normalizes the mutable display name and optional bio", () => {
    expect(
      acceptMemberProfileFields({
        displayName: "  Кирилл\n  Сачков  ",
        bio: "  Строю инженерные продукты.\r\nПишу о практике.  ",
      }),
    ).toEqual({
      ok: true,
      fields: {
        displayName: "Кирилл Сачков",
        bio: "Строю инженерные продукты.\nПишу о практике.",
      },
    });
    expect(
      acceptMemberProfileFields({ displayName: "Участник", bio: "   " }),
    ).toEqual({
      ok: true,
      fields: { displayName: "Участник", bio: null },
    });
  });

  test("rejects missing, oversized and control-character fields", () => {
    expect(
      acceptMemberProfileFields({ displayName: " ", bio: null }),
    ).toEqual({
      ok: false,
      issues: [{ field: "displayName", code: "required" }],
    });
    expect(
      acceptMemberProfileFields({
        displayName: "А".repeat(81),
        bio: `Описание${"Б".repeat(500)}`,
      }),
    ).toEqual({
      ok: false,
      issues: [
        { field: "displayName", code: "too_long" },
        { field: "bio", code: "too_long" },
      ],
    });
    expect(
      acceptMemberProfileFields({ displayName: "Имя\u0000", bio: null }),
    ).toEqual({
      ok: false,
      issues: [{ field: "displayName", code: "invalid_characters" }],
    });
  });

  test("counts Unicode code points instead of UTF-16 code units", () => {
    expect(
      acceptMemberProfileFields({ displayName: "🛠️ Кирилл", bio: null }),
    ).toMatchObject({ ok: true });
  });
});
