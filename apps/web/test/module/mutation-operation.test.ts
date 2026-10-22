import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const fakes = vi.hoisted(() => ({
  expirePublicCatalog: vi.fn(),
  token: vi.fn(),
  LogtoSessionUnavailableError: class extends Error {},
}));

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidateTag: fakes.expirePublicCatalog,
}));
vi.mock("@/shared/auth/session-adapter.server", () => ({
  sessionAdapter: {
    accessToken: fakes.token,
    baseUrl: () => "https://inside.example.test",
  },
  LogtoSessionUnavailableError: fakes.LogtoSessionUnavailableError,
}));

import { defineMutationOperation } from "@/shared/api/mutation-operation";
import { MAX_BROWSER_MUTATION_BYTES } from "@/shared/api/mutation-limits";
import { handleMutationOperation } from "@/shared/auth/index.server";

import { routeBrowserMutations } from "../support/mutation-operation-route";

const resultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("renamed"), name: z.string() }).strict(),
  z.object({ kind: z.literal("invalid_input") }).strict(),
  z.object({ kind: z.literal("failed"), reference: z.string() }).strict(),
]);
type Result = z.infer<typeof resultSchema>;

const renameOperation = defineMutationOperation({
  input: z.object({ name: z.string().trim().min(1) }),
  method: "POST",
  path: "/api/authoring/rename",
  result: resultSchema,
  transportFailure: (failure): Result => ({
    kind: "failed",
    reference:
      failure.kind === "contract" ? "contract" : String(failure.status),
  }),
});

const execute = vi.fn(
  (input: { readonly name: string }, accessToken: string): Promise<Result> =>
    Promise.resolve({ kind: "renamed", name: `${input.name}:${accessToken}` }),
);

function handle(request: Request) {
  return handleMutationOperation(request, renameOperation, {
    execute,
    invalidInput: (): Result => ({ kind: "invalid_input" }),
  });
}

function post(body: BodyInit, headers: Record<string, string> = {}) {
  return new Request("https://inside.example.test/api/authoring/rename", {
    body,
    headers: {
      "content-type": "application/json",
      origin: "https://inside.example.test",
      ...headers,
    },
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.token.mockResolvedValue("token");
});

describe("a mutation operation's Route Handler", () => {
  it("parses the JSON input with the operation schema and answers privately", async () => {
    const response = await handle(post(JSON.stringify({ name: " Новое " })));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(response.headers.get("vary")).toBe("cookie");
    await expect(response.json()).resolves.toEqual({
      kind: "renamed",
      name: "Новое:token",
    });
    expect(fakes.expirePublicCatalog).toHaveBeenCalledOnce();
  });

  it("answers input outside the schema with the operation's own outcome", async () => {
    const response = await handle(post(JSON.stringify({ name: " " })));

    await expect(response.json()).resolves.toEqual({ kind: "invalid_input" });
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["another origin", post("{}", { origin: "https://outside.test" }), 403],
    [
      "a declared body above the limit",
      post("{}", { "content-length": String(MAX_BROWSER_MUTATION_BYTES + 1) }),
      413,
    ],
  ])("rejects %s before the session", async (_case, request, status) => {
    const response = await handle(request);

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(fakes.token).not.toHaveBeenCalled();
  });

  it.each([
    ["a form body", post(new FormData(), { "content-type": "" }), 400],
    ["malformed JSON", post("{"), 400],
    [
      "a JSON body above the limit",
      post(JSON.stringify({ name: "я".repeat(MAX_BROWSER_MUTATION_BYTES) })),
      413,
    ],
  ])("rejects %s without calling Nest", async (_case, request, status) => {
    const response = await handle(request);

    expect(response.status).toBe(status);
    expect(execute).not.toHaveBeenCalled();
  });

  it("stops reading a streamed body without a declared length at the limit", async () => {
    const chunk = new TextEncoder().encode("я".repeat(512 * 1_024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const request = new Request(
      "https://inside.example.test/api/authoring/rename",
      {
        body,
        duplex: "half",
        headers: {
          "content-type": "application/json",
          origin: "https://inside.example.test",
        },
        method: "POST",
      } as RequestInit,
    );

    expect((await handle(request)).status).toBe(413);
    expect(sent).toBeLessThan(5);
    expect(execute).not.toHaveBeenCalled();
  });

  it("answers a body that exhausts the schema's stack as a bad request", async () => {
    // Глубина, при которой рекурсия схемы исчерпывает стек, зависит от потока; здесь схема
    // бросает ту же ошибку сразу.
    const exhausting = defineMutationOperation({
      ...renameOperation,
      input: z.custom<{ readonly name: string }>(() => {
        throw new RangeError("Maximum call stack size exceeded");
      }),
    });

    const response = await handleMutationOperation(
      post(JSON.stringify({ name: "Новое" })),
      exhausting,
      { execute, invalidInput: (): Result => ({ kind: "invalid_input" }) },
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(execute).not.toHaveBeenCalled();
  });

  it("separates a missing session from an unavailable identity provider", async () => {
    fakes.token.mockRejectedValueOnce(new fakes.LogtoSessionUnavailableError());
    expect((await handle(post("{}"))).status).toBe(401);

    fakes.token.mockRejectedValueOnce(new Error("Logto unavailable"));
    expect((await handle(post("{}"))).status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
  });

  it("expires the catalog and answers 503 when an authoring write loses its answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    execute.mockRejectedValueOnce(new Error("socket hang up"));

    const response = await handle(post(JSON.stringify({ name: "Новое" })));

    expect(response.status).toBe(503);
    expect(fakes.expirePublicCatalog).toHaveBeenCalledOnce();
  });
});

describe("a mutation operation's browser adapter", () => {
  it("maps transport failures through the operation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(renameOperation.send({ name: "x" })).resolves.toEqual({
      kind: "failed",
      reference: "503",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("<html>", { status: 200 })),
    );
    await expect(renameOperation.send({ name: "x" })).resolves.toEqual({
      kind: "failed",
      reference: "502",
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ kind: "renamed" })),
    );
    await expect(renameOperation.send({ name: "x" })).resolves.toEqual({
      kind: "failed",
      reference: "contract",
    });
  });

  it("reaches its handler through the literal path and method", async () => {
    const { fetch } = routeBrowserMutations({
      "/api/authoring/rename": { POST: handle },
    });

    await expect(renameOperation.send({ name: "Новое" })).resolves.toEqual({
      kind: "renamed",
      name: "Новое:token",
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/authoring/rename",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        method: "POST",
      }),
    );
  });
});
