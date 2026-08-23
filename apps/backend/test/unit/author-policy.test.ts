import { describe, expect, test } from "vitest";

import {
  authorizeAuthor,
  authorizePublish,
  type AuthorPolicy,
} from "../../src/modules/materials/application/ports/author-policy.js";

describe("AuthorPolicy", () => {
  test("distinguishes a denied action from an unavailable policy", async () => {
    const publishRequest = {
      action: "publish" as const,
      principalId: "principal",
      materialId: "material",
      revisionId: "revision",
    };
    const denied: AuthorPolicy = {
      canAuthor: () => false,
      canPublish: () => false,
    };
    const unavailable: AuthorPolicy = {
      canAuthor: () => {
        throw new Error("Identity is unavailable");
      },
      canPublish: () => Promise.reject(new Error("Identity is unavailable")),
    };

    await expect(authorizeAuthor(denied, "principal")).resolves.toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    await expect(authorizePublish(denied, publishRequest)).resolves.toEqual({
      ok: false,
      error: { code: "forbidden" },
    });
    await expect(authorizeAuthor(unavailable, "principal")).resolves.toEqual({
      ok: false,
      error: { code: "dependency_unavailable", retryable: true },
    });
    await expect(authorizePublish(unavailable, publishRequest)).resolves.toEqual({
      ok: false,
      error: { code: "dependency_unavailable", retryable: true },
    });
  });
});
