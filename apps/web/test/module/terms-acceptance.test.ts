import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/shared/api/backend/index.server", () => ({
  resumeTelegramAccountSignIn: vi.fn(),
  requestAcceptTerms: vi.fn(),
}));

import { safeReturnPath, welcomePath } from "@/features/terms-acceptance";
import { executeAcceptTerms } from "@/features/terms-acceptance/api/accept-terms.server";

const version = "1";
const digest = "a".repeat(64);
const operationId = "7a0c2c1e-2d4b-4a57-8a1e-0d9d6f3b8a11";

function form(input: unknown): FormData {
  const data = new FormData();
  data.set("input", JSON.stringify(input));
  return data;
}

function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "ES384" })}.${part({ sub: "member", ...claims })}.signature`;
}

const accepted = () =>
  Promise.resolve({
    ok: true as const,
    body: { ok: true, acceptanceRef: operationId },
    response: Response.json({}),
  });

describe("first sign-in screen", () => {
  it("returns only to an address of this site", () => {
    expect(safeReturnPath("/products/platform-inside/buy")).toBe(
      "/products/platform-inside/buy",
    );
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "account",
      undefined,
    ])
      expect(safeReturnPath(value)).toBe("/");
    expect(welcomePath("/account?tab=1")).toBe(
      "/welcome?returnTo=%2Faccount%3Ftab%3D1",
    );
  });

  it("records the button label chosen by the server, not by the browser", async () => {
    const accept = vi.fn(accepted);
    const resumeTelegramSignIn = vi.fn();
    await expect(
      executeAcceptTerms(
        form({
          operationId,
          version,
          digest,
          buttonLabel: "Подменённая подпись",
        }),
        token({}),
        { accept, resumeTelegramSignIn },
      ),
    ).resolves.toEqual({ kind: "unavailable" });
    await expect(
      executeAcceptTerms(form({ operationId, version, digest }), token({}), {
        accept,
        resumeTelegramSignIn,
      }),
    ).resolves.toEqual({ kind: "accepted" });
    expect(accept).toHaveBeenCalledWith(
      {
        operationId,
        version,
        digest,
        buttonLabel: "Принять условия и продолжить",
      },
      expect.any(String),
    );
    // Refreshed access tokens do not say whether this Account has a deferred Telegram receipt.
    expect(resumeTelegramSignIn).toHaveBeenCalledWith(token({}));
  });

  it("finishes a Telegram bot link only after the terms are accepted", async () => {
    const telegramToken = token({
      inside_telegram_sign_in: {
        subjectRef: operationId,
        requestRef: operationId,
      },
    });
    const resumeTelegramSignIn = vi
      .fn()
      .mockRejectedValue(new Error("expired"));
    await expect(
      executeAcceptTerms(
        form({ operationId, version, digest }),
        telegramToken,
        {
          accept: vi.fn(accepted),
          resumeTelegramSignIn,
        },
      ),
    ).resolves.toEqual({ kind: "accepted" });
    expect(resumeTelegramSignIn).toHaveBeenCalledWith(telegramToken);

    const refused = vi.fn();
    await expect(
      executeAcceptTerms(
        form({ operationId, version, digest }),
        telegramToken,
        {
          accept: () =>
            Promise.resolve({
              ok: false as const,
              problem: { code: "document_changed" },
              response: Response.json({}, { status: 409 }),
            }),
          resumeTelegramSignIn: refused,
        },
      ),
    ).resolves.toEqual({ kind: "document_changed" });
    expect(refused).not.toHaveBeenCalled();
  });
});
