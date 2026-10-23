import { describe, expect, test } from "vitest";

import { acceptAccountProfileFields } from "../../src/modules/account-profiles/domain/profile-fields.js";

describe("Account Profile fields", () => {
  test("trims the display name without rewriting authored nonblank text", () => {
    expect(
      acceptAccountProfileFields({
        displayName: "  Кирилл   Сачков  ",
        bio: "  Строю инженерные продукты.\r\nПишу о практике.  ",
      }),
    ).toEqual({
      ok: true,
      fields: {
        displayName: "Кирилл   Сачков",
        bio: "  Строю инженерные продукты.\r\nПишу о практике.  ",
      },
    });
    expect(
      acceptAccountProfileFields({ displayName: "Участник", bio: "   " }),
    ).toEqual({
      ok: true,
      fields: { displayName: "Участник", bio: null },
    });
  });

  test("rejects missing, oversized and control-character fields", () => {
    expect(acceptAccountProfileFields({ displayName: " ", bio: null })).toEqual(
      {
        ok: false,
        issues: [{ field: "displayName", code: "required" }],
      },
    );
    expect(
      acceptAccountProfileFields({
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
      acceptAccountProfileFields({ displayName: "Имя\u0000", bio: null }),
    ).toEqual({
      ok: false,
      issues: [{ field: "displayName", code: "invalid_characters" }],
    });
    expect(
      acceptAccountProfileFields({ displayName: "Кирилл\nСачков", bio: null }),
    ).toEqual({
      ok: false,
      issues: [{ field: "displayName", code: "invalid_characters" }],
    });
  });

  test("counts Unicode code points instead of UTF-16 code units", () => {
    expect(
      acceptAccountProfileFields({ displayName: "🛠️ Кирилл", bio: null }),
    ).toMatchObject({ ok: true });
  });
});
