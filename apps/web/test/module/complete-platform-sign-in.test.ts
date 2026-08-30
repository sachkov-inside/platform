import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BackendModule from "@/shared/api/backend/index.server";

const fakes = vi.hoisted(() => ({
  establishAccount: vi.fn(() => Promise.resolve()),
  resolveAccount: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/shared/api/backend/index.server", async (importOriginal) => {
  const original = await importOriginal<typeof BackendModule>();
  return {
    ...original,
    establishAccount: fakes.establishAccount,
    resolveAccount: fakes.resolveAccount,
  };
});

import { BackendConnectionError } from "@/shared/api/backend/index.server";
import { completePlatformSignIn } from "@/shared/auth/complete-platform-sign-in.server";

describe("completePlatformSignIn", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a returning Account without requiring fresh email proof", async () => {
    await expect(completePlatformSignIn("access-token")).resolves.toBe("complete");
    expect(fakes.resolveAccount).toHaveBeenCalledWith("access-token");
    expect(fakes.establishAccount).not.toHaveBeenCalled();
  });

  it("establishes an Account when the identity is not known yet", async () => {
    fakes.resolveAccount.mockRejectedValueOnce(
      new BackendConnectionError("rejected", "Account not found"),
    );

    await expect(completePlatformSignIn("access-token")).resolves.toBe("complete");
    expect(fakes.establishAccount).toHaveBeenCalledWith("access-token");
  });

  it("keeps provider outages retryable without attempting establishment", async () => {
    fakes.resolveAccount.mockRejectedValueOnce(
      new BackendConnectionError("unavailable", "Provider unavailable"),
    );

    await expect(completePlatformSignIn("access-token")).resolves.toBe("retryable");
    expect(fakes.establishAccount).not.toHaveBeenCalled();
  });

  it("keeps invalid backend responses visible", async () => {
    fakes.resolveAccount.mockRejectedValueOnce(
      new BackendConnectionError("invalid-response", "Invalid response"),
    );

    await expect(completePlatformSignIn("access-token")).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
});
