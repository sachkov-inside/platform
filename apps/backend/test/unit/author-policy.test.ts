import { describe, expect, test } from "vitest";

import {
  authorizeManager,
  type AuthorPolicy,
} from "../../src/modules/materials/ports/author-policy.js";

describe("AuthorPolicy", () => {
  test("distinguishes a denied materials:manage check from unavailable Accounts", async () => {
    const denied: AuthorPolicy = { canManage: () => false };
    const unavailable: AuthorPolicy = {
      canManage: () => Promise.reject(new Error("Accounts is unavailable")),
    };

    await expect(authorizeManager(denied, "account")).resolves.toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    await expect(authorizeManager(unavailable, "account")).resolves.toEqual({
      ok: false,
      error: { code: "dependency_unavailable", retryable: true },
    });
  });
});
