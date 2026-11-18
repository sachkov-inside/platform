import { acceptTermsInputSchema } from "@/features/terms-acceptance/model/terms-acceptance";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureWebRuntime } from "../support/web-runtime";
import { interceptBackendHttp } from "../support/backend-http";
import { commerceFixtureFacts } from "../../../../scenarios/commerce.mjs";

import { safeReturnPath, welcomePath } from "@/features/terms-acceptance";
import { executeAcceptTerms } from "@/features/terms-acceptance/api/accept-terms.server";

const version = "1";
const digest = "a".repeat(64);
const operationId = "7a0c2c1e-2d4b-4a57-8a1e-0d9d6f3b8a11";

/** The body the Route Handler admits: the operation schema parses what the browser sent. */
function form(input: unknown) {
  return acceptTermsInputSchema.parse(input);
}

function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "ES384" })}.${part({ sub: "member", ...claims })}.signature`;
}

const acceptPath = "/accounts/current/legal-acceptances/terms";
const resumePath = "/accounts/current/telegram-sign-in/resume";
const backend = vi.fn<(request: Request) => Promise<Response>>();
let acceptStatus: number;
let resumeStatus: number;
const unexpected: string[] = [];
beforeEach(() => {
  configureWebRuntime();
  acceptStatus = 200;
  resumeStatus = 200;
  unexpected.length = 0;
  backend.mockReset();
  backend.mockImplementation((request) => {
    const path = new URL(request.url).pathname;
    if (path === acceptPath)
      return Promise.resolve(
        acceptStatus === 200
          ? Response.json({ ok: true, acceptanceRef: operationId })
          : Response.json(
              { code: "document_changed" },
              { status: acceptStatus },
            ),
      );
    if (path === resumePath)
      return Promise.resolve(
        resumeStatus === 200
          ? Response.json({
              account: { accountId: commerceFixtureFacts.buyerAccountId },
            })
          : Response.json(
              { code: "dependency_unavailable" },
              { status: resumeStatus },
            ),
      );
    unexpected.push(request.url);
    return Promise.reject(
      new Error(`Unexpected backend request ${request.url}`),
    );
  });
  interceptBackendHttp(backend);
});
afterEach(() => {
  expect(unexpected).toEqual([]);
  for (const [request] of backend.mock.calls) {
    expect(new URL(request.url).origin).toBe(
      "https://platform-api.example.test",
    );
    expect(new URL(request.url).search).toBe("");
    expect(request.method).toBe("POST");
  }
});
function outgoing(index: number): Request {
  const request = backend.mock.calls[index]?.[0];
  if (request === undefined)
    throw new Error("Expected external backend request");
  return request;
}
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
    expect(
      acceptTermsInputSchema.safeParse({
        operationId,
        version,
        digest,
        buttonLabel: "Подменённая подпись",
      }).success,
    ).toBe(false);
    await expect(
      executeAcceptTerms(form({ operationId, version, digest }), token({})),
    ).resolves.toEqual({ kind: "accepted" });
    expect(backend).toHaveBeenCalledTimes(2);
    expect(outgoing(0).url).toBe(
      "https://platform-api.example.test/accounts/current/legal-acceptances/terms",
    );
    expect(await outgoing(0).json()).toEqual({
      operationId,
      version,
      digest,
      buttonLabel: "Принять условия и продолжить",
    });
    expect(outgoing(0).headers.get("authorization")).toBe(
      `Bearer ${token({})}`,
    );
    // Refreshed access tokens do not say whether this Account has a deferred Telegram receipt.
    expect(outgoing(1).url).toBe(
      "https://platform-api.example.test/accounts/current/telegram-sign-in/resume",
    );
    expect(outgoing(1).headers.get("authorization")).toBe(
      `Bearer ${token({})}`,
    );
    expect(outgoing(1).body).toBeNull();
  });

  it("finishes a Telegram bot link only after the terms are accepted", async () => {
    const telegramToken = token({
      inside_telegram_sign_in: {
        subjectRef: operationId,
        requestRef: operationId,
      },
    });
    resumeStatus = 503;
    await expect(
      executeAcceptTerms(form({ operationId, version, digest }), telegramToken),
    ).resolves.toEqual({ kind: "accepted" });
    expect(backend).toHaveBeenCalledTimes(2);
    expect(outgoing(0).url).toBe(
      "https://platform-api.example.test/accounts/current/legal-acceptances/terms",
    );
    expect(outgoing(1).url).toBe(
      "https://platform-api.example.test/accounts/current/telegram-sign-in/resume",
    );
    for (const [request] of backend.mock.calls)
      expect(request.headers.get("authorization")).toBe(
        `Bearer ${telegramToken}`,
      );
    acceptStatus = 409;
    await expect(
      executeAcceptTerms(form({ operationId, version, digest }), telegramToken),
    ).resolves.toEqual({ kind: "document_changed" });
    expect(backend).toHaveBeenCalledTimes(3);
    expect(outgoing(2).url).toBe(
      "https://platform-api.example.test/accounts/current/legal-acceptances/terms",
    );
    expect(outgoing(2).headers.get("authorization")).toBe(
      `Bearer ${telegramToken}`,
    );
  });
});
