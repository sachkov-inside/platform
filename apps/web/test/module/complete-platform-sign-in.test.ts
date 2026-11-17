import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commerceFixtureFacts } from "../../../../scenarios/commerce.mjs";
import { configureWebRuntime } from "../support/web-runtime";
import { interceptBackendHttp } from "../support/backend-http";
import { completePlatformSignIn } from "@/shared/auth/complete-platform-sign-in.server";

const token = "eyJhbGciOiJub25lIn0.e30.test";
const telegramToken = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ inside_telegram_sign_in: { subjectRef: "31000000-0000-4000-8000-000000000001", requestRef: "31000000-0000-4000-8000-000000000002" } })).toString("base64url")}.test`;
interface BackendReply {
  readonly method: string;
  readonly path: string;
  readonly response: Response;
}
const backend = vi.fn<(request: Request) => Promise<Response>>();
let replies: BackendReply[];
let expectedToken: string;
function respond(method: string, path: string, body: unknown, status = 200) {
  replies.push({ method, path, response: Response.json(body, { status }) });
}
function account() {
  return { account: { accountId: commerceFixtureFacts.buyerAccountId } };
}
function problem(code: string, status: number, title: string) {
  return {
    code,
    detail: "Account request could not be completed.",
    status,
    title,
    type: `urn:inside:problem:${code}`,
  };
}
beforeEach(() => {
  configureWebRuntime();
  replies = [];
  expectedToken = token;
  backend.mockReset();
  backend.mockImplementation(() => {
    const response = replies[backend.mock.calls.length - 1]?.response;
    return response === undefined
      ? Promise.reject(new Error("Unexpected backend request"))
      : Promise.resolve(response);
  });
  interceptBackendHttp(backend);
});
afterEach(() => {
  expect(backend).toHaveBeenCalledTimes(replies.length);
  replies.forEach((reply, index) => {
    const request = backend.mock.calls[index]?.[0];
    if (request === undefined) throw new Error("Expected backend request");
    expect(request.method).toBe(reply.method);
    expect(request.url).toBe(`https://platform-api.example.test${reply.path}`);
    expect(request.headers.get("authorization")).toBe(
      `Bearer ${expectedToken}`,
    );
    expect(request.body).toBeNull();
  });
});

describe("completePlatformSignIn", () => {
  it("resolves a returning Account without requiring fresh email proof", async () => {
    respond("GET", "/accounts/current", account());
    await expect(completePlatformSignIn(token)).resolves.toBe("complete");
    expect(backend).toHaveBeenCalledOnce();
  });

  it("establishes an Account when the identity is not known yet", async () => {
    respond(
      "GET",
      "/accounts/current",
      problem("account_not_found", 401, "Account verification failed"),
      401,
    );
    respond("POST", "/accounts", account(), 201);
    await expect(completePlatformSignIn(token)).resolves.toBe("complete");
    expect(backend).toHaveBeenCalledTimes(2);
  });

  it("keeps provider outages retryable without attempting establishment", async () => {
    respond(
      "GET",
      "/accounts/current",
      problem("dependency_unavailable", 503, "Identity provider unavailable"),
      503,
    );
    await expect(completePlatformSignIn(token)).resolves.toBe("retryable");
    expect(backend).toHaveBeenCalledOnce();
  });

  it("keeps invalid backend responses visible", async () => {
    respond("GET", "/accounts/current", {});
    await expect(completePlatformSignIn(token)).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
});

it("rejects a disabled Telegram callback even when ordinary resolution would accept the existing Account", async () => {
  expectedToken = telegramToken;
  respond(
    "POST",
    "/integrations/telegram/v1/sign-in/complete",
    problem("invalid_proof", 401, "Account verification failed"),
    401,
  );
  await expect(completePlatformSignIn(telegramToken)).rejects.toMatchObject({
    code: "rejected",
  });
  expect(backend).toHaveBeenCalledOnce();
});

it("retries Telegram finalization without falling back to email establishment", async () => {
  expectedToken = telegramToken;
  respond(
    "POST",
    "/integrations/telegram/v1/sign-in/complete",
    problem("dependency_unavailable", 503, "Identity provider unavailable"),
    503,
  );
  await expect(completePlatformSignIn(telegramToken)).resolves.toBe(
    "retryable",
  );
  expect(backend).toHaveBeenCalledOnce();
});
