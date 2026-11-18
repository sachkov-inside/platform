import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { z } from "zod";

const fakes = vi.hoisted(() => ({
  expirePublicCatalog: vi.fn(),
}));

vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidateTag: fakes.expirePublicCatalog,
}));
import { defineMutationOperation } from "@/shared/api/mutation-operation";
import { MAX_BROWSER_MUTATION_BYTES } from "@/shared/api/mutation-limits";
import { handleMutationOperation } from "@/shared/auth/index.server";

import { realBffSession } from "../support/real-bff-session";
import {
  interceptIdentityOutage,
  expectIdentityOutage,
} from "../support/identity-http";
import { sessionAdapter } from "@/shared/auth/session-adapter.server";
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
  return scope(() =>
    handleMutationOperation(request, renameOperation, {
      execute,
      invalidInput: (): Result => ({ kind: "invalid_input" }),
    }),
  );
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

let scope: Awaited<ReturnType<typeof realBffSession>>;
let sessionRead: MockInstance<typeof sessionAdapter.accessToken>;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2030-03-01T12:00:00Z"));
  scope = await realBffSession("token");
  sessionRead = vi.spyOn(sessionAdapter, "accessToken");
});
afterEach(() => {
  vi.useRealTimers();
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
    expect(sessionRead).not.toHaveBeenCalled();
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

    const response = await scope(() =>
      handleMutationOperation(
        post(JSON.stringify({ name: "Новое" })),
        exhausting,
        { execute, invalidInput: (): Result => ({ kind: "invalid_input" }) },
      ),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store, private");
    expect(execute).not.toHaveBeenCalled();
  });

  it("separates a missing session from an unavailable identity provider", async () => {
    scope = await realBffSession(null);
    expect((await handle(post("{}"))).status).toBe(401);

    scope = await realBffSession({ refreshToken: "expired-generic-operation" });
    const identity = interceptIdentityOutage();
    expect((await handle(post("{}"))).status).toBe(503);
    expectIdentityOutage(identity);
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
  it.each([
    ["offline", "503"],
    ["html", "502"],
    ["missing-name", "contract"],
  ] as const)(
    "maps named %s transport corruption after a valid real handler response",
    async (fault, reference) => {
      const receipts: {
        method: string;
        url: string;
        status: number;
        payload: unknown;
        bodyUsed: boolean;
      }[] = [];
      vi.stubGlobal(
        "fetch",
        async (
          input: RequestInfo | URL,
          init?: RequestInit,
        ): Promise<Response> => {
          const target =
            input instanceof Request
              ? input
              : new URL(input, "https://inside.example.test");
          const request = new Request(target, init);
          if (
            request.method !== "POST" ||
            request.url !== "https://inside.example.test/api/authoring/rename"
          )
            throw new Error("Unexpected transport fault request");
          request.headers.set("origin", "https://inside.example.test");
          const response = await handle(request);
          const payload: unknown = await response.json();
          receipts.push({
            method: request.method,
            url: request.url,
            status: response.status,
            payload,
            bodyUsed: response.bodyUsed,
          });
          if (fault === "offline")
            throw new TypeError("transport delivery interrupted");
          return fault === "html"
            ? new Response("<html>", {
                status: response.status,
                headers: response.headers,
              })
            : Response.json(
                { kind: "renamed" },
                { status: response.status, headers: response.headers },
              );
        },
      );
      await expect(renameOperation.send({ name: "x" })).resolves.toEqual({
        kind: "failed",
        reference,
      });
      expect(execute).toHaveBeenCalledOnce();
      expect(receipts).toEqual([
        {
          method: "POST",
          url: "https://inside.example.test/api/authoring/rename",
          status: 200,
          payload: { kind: "renamed", name: "x:token" },
          bodyUsed: true,
        },
      ]);
    },
  );

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
