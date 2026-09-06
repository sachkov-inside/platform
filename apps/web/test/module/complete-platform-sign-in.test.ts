import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as BackendModule from "@/shared/api/backend/index.server";

const token = "eyJhbGciOiJub25lIn0.e30.test";

const fakes = vi.hoisted(() => ({
  completeTelegramAccountSignIn: vi.fn(() => Promise.resolve()),
  establishAccount: vi.fn(() => Promise.resolve()),
  resolveAccount: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/shared/api/backend/index.server", async (importOriginal) => {
  const original = await importOriginal<typeof BackendModule>();
  return {
    ...original,
    establishAccount: fakes.establishAccount,
    completeTelegramAccountSignIn: fakes.completeTelegramAccountSignIn,
    resolveAccount: fakes.resolveAccount,
  };
});

import { BackendConnectionError } from "@/shared/api/backend/index.server";
import { completePlatformSignIn } from "@/shared/auth/complete-platform-sign-in.server";

describe("completePlatformSignIn", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a returning Account without requiring fresh email proof", async () => {
    await expect(completePlatformSignIn(token)).resolves.toBe("complete");
    expect(fakes.resolveAccount).toHaveBeenCalledWith(token);
    expect(fakes.establishAccount).not.toHaveBeenCalled();
  });

  it("establishes an Account when the identity is not known yet", async () => {
    fakes.resolveAccount.mockRejectedValueOnce(
      new BackendConnectionError("rejected", "Account not found"),
    );

    await expect(completePlatformSignIn(token)).resolves.toBe("complete");
    expect(fakes.establishAccount).toHaveBeenCalledWith(token);
  });

  it("keeps provider outages retryable without attempting establishment", async () => {
    fakes.resolveAccount.mockRejectedValueOnce(
      new BackendConnectionError("unavailable", "Provider unavailable"),
    );

    await expect(completePlatformSignIn(token)).resolves.toBe("retryable");
    expect(fakes.establishAccount).not.toHaveBeenCalled();
  });

  it("keeps invalid backend responses visible", async () => {
    fakes.resolveAccount.mockRejectedValueOnce(
      new BackendConnectionError("invalid-response", "Invalid response"),
    );

    await expect(completePlatformSignIn(token)).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
});

const telegramToken = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ inside_telegram_sign_in: { subjectRef: "31000000-0000-4000-8000-000000000001", requestRef: "31000000-0000-4000-8000-000000000002" } })).toString("base64url")}.test`;
it("rejects a disabled Telegram callback even when ordinary resolution would accept the existing Account", async () => {
  vi.clearAllMocks();
  fakes.completeTelegramAccountSignIn.mockRejectedValueOnce(new BackendConnectionError("rejected", "Telegram disabled"));
  await expect(completePlatformSignIn(telegramToken)).rejects.toMatchObject({ code: "rejected" });
  expect(fakes.completeTelegramAccountSignIn).toHaveBeenCalledWith(telegramToken);
  expect(fakes.resolveAccount).not.toHaveBeenCalled();
  expect(fakes.establishAccount).not.toHaveBeenCalled();
});
it("retries Telegram finalization without falling back to email establishment", async () => {
  vi.clearAllMocks();
  fakes.completeTelegramAccountSignIn.mockRejectedValueOnce(new BackendConnectionError("unavailable", "Provider unavailable"));
  await expect(completePlatformSignIn(telegramToken)).resolves.toBe("retryable");
  expect(fakes.resolveAccount).not.toHaveBeenCalled();
  expect(fakes.establishAccount).not.toHaveBeenCalled();
});
