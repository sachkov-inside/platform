import { describe, expect, it, vi } from "vitest";

import type { IdentityPrincipals } from "../../src/modules/identity-principals/index.js";
import { createIdentityAuthorPolicy } from "../../src/modules/materials/index.js";

describe("Identity-backed Materials AuthorPolicy", () => {
  it("asks the identity owner for current author and publish grants", async () => {
    const checkPermission = vi
      .fn<IdentityPrincipals["checkPermission"]>()
      .mockResolvedValueOnce({ ok: true, allowed: true })
      .mockResolvedValueOnce({ ok: true, allowed: false });
    const policy = createIdentityAuthorPolicy({ checkPermission });

    await expect(policy.canAuthor("principal-1")).resolves.toBe(true);
    await expect(
      policy.canPublish({
        action: "publish",
        principalId: "principal-1",
        materialId: "material-1",
        revisionId: "revision-1",
      }),
    ).resolves.toBe(false);
    expect(checkPermission).toHaveBeenNthCalledWith(1, {
      principalId: "principal-1",
      permission: "materials:author",
    });
    expect(checkPermission).toHaveBeenNthCalledWith(2, {
      principalId: "principal-1",
      permission: "materials:publish",
    });
  });

  it("fails closed as a dependency error instead of treating identity failure as denial", async () => {
    const policy = createIdentityAuthorPolicy({
      checkPermission: vi.fn().mockResolvedValue({
        ok: false,
        error: { code: "internal_error" },
      }),
    });

    await expect(policy.canAuthor("principal-1")).rejects.toThrow(
      "Identity permission check failed",
    );
  });
});
