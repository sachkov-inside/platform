import { createServer } from "node:http";

import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";

let setup: typeof import("../integration/setup/postgres.global.js").default;

type Scenario =
  | "stream-error"
  | "detail-error"
  | "http-error"
  | "missing-image"
  | "success"
  | "cached"
  | "disconnect"
  | "open-error";

function assembleDockerFixture() {
  let scenario: Scenario = "stream-error";
  let pulled = false;
  let verified = false;
  const requests: string[] = [];
  const primaryError = "registry fixture: acquisition denied";
  let streamClosed = Promise.resolve();
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    requests.push(`${request.method ?? "GET"} ${path}`);
    response.setHeader("Content-Type", "application/json");
    if (path === "/info") {
      response.end(
        JSON.stringify({ OperatingSystem: "Linux", OSType: "linux" }),
      );
    } else if (path === "/containers/json") {
      response.end("[]");
    } else if (path === "/images/create") {
      pulled = true;
      if (scenario === "http-error") {
        response.statusCode = 503;
        response.end(JSON.stringify({ message: primaryError }));
      } else if (scenario === "open-error") {
        streamClosed = new Promise<void>((resolve) =>
          response.once("close", resolve),
        );
        response.write(`${JSON.stringify({ error: primaryError })}\n`);
      } else if (scenario === "disconnect") {
        response.write(`${JSON.stringify({ status: "Downloading" })}\n`, () =>
          response.destroy(),
        );
      } else if (scenario === "stream-error" || scenario === "detail-error") {
        response.end(
          `${JSON.stringify({ errorDetail: { message: primaryError }, ...(scenario === "stream-error" ? { error: primaryError } : {}) })}\n`,
        );
      } else {
        response.end(`${JSON.stringify({ status: "Download complete" })}\n`);
      }
    } else if (
      path.startsWith("/images/") &&
      path.endsWith("/json") &&
      ((scenario === "success" && pulled) || scenario === "cached")
    ) {
      verified = true;
      response.end(JSON.stringify({ Id: "sha256:fixture" }));
    } else if (path === "/containers/create" && verified) {
      response.statusCode = 500;
      response.end(
        JSON.stringify({
          message: "fixture: reached create with verified image",
        }),
      );
    } else {
      response.statusCode = 404;
      response.end(
        JSON.stringify({
          message: "No such image: PostgreSQL acquisition fixture",
        }),
      );
    }
  });
  return {
    server,
    requests,
    primaryError,
    closed: () => streamClosed,
    reset(next: Scenario) {
      scenario = next;
      pulled = false;
      verified = false;
      requests.length = 0;
      streamClosed = Promise.resolve();
    },
  };
}

let fixture: ReturnType<typeof assembleDockerFixture>;

beforeAll(async () => {
  fixture = assembleDockerFixture();
  await new Promise<void>((resolve) =>
    fixture.server.listen(0, "127.0.0.1", resolve),
  );
  const address = fixture.server.address();
  if (address === null || typeof address === "string")
    throw new Error("Fixture did not bind TCP");
  vi.stubEnv("DOCKER_HOST", `tcp://127.0.0.1:${address.port}`);
  vi.stubEnv("DOCKER_TLS_VERIFY", "0");
  vi.stubEnv("TESTCONTAINERS_HOST_OVERRIDE", "127.0.0.1");
  vi.stubEnv("TESTCONTAINERS_RYUK_DISABLED", "true");
  vi.stubEnv("DOCKER_AUTH_CONFIG", '{"auths":{}}');
  ({ default: setup } =
    await import("../integration/setup/postgres.global.js"));
});

beforeEach(() => fixture.reset("stream-error"));

afterAll(async () => {
  vi.unstubAllEnvs();
  fixture.server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    fixture.server.close((error) =>
      error === undefined ? resolve() : reject(error),
    ),
  );
  expect(fixture.server.listening).toBe(false);
});

async function runSetup() {
  const provide = vi.fn();
  try {
    await setup({ isRootProject: () => true, provide });
    throw new Error("Fixture must stop setup before SQL");
  } catch (error) {
    expect(provide).not.toHaveBeenCalled();

    return error;
  }
}

test.each(["stream-error", "detail-error", "http-error"] as const)(
  "PostgreSQL setup preserves %s before container creation",
  async (scenario) => {
    fixture.reset(scenario);
    const error = await runSetup();
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty(
      "message",
      expect.stringContaining(fixture.primaryError),
    );
    expect(
      fixture.requests.some((request) =>
        request.startsWith("POST /images/create"),
      ),
    ).toBe(true);
    expect(
      fixture.requests.some((request) =>
        request.startsWith("POST /containers/create"),
      ),
    ).toBe(false);
  },
);

test("a failed acquisition closes its unfinished pull stream without replacing the error", async () => {
  fixture.reset("open-error");
  expect(await runSetup()).toHaveProperty(
    "message",
    expect.stringContaining(fixture.primaryError),
  );
  await fixture.closed();
  expect(
    fixture.requests.some((request) =>
      request.startsWith("POST /containers/create"),
    ),
  ).toBe(false);
});

test("a completed pull without a local image cannot create PostgreSQL", async () => {
  fixture.reset("missing-image");
  expect(await runSetup()).toHaveProperty(
    "message",
    expect.stringContaining("No such image"),
  );
  expect(
    fixture.requests.some((request) =>
      request.startsWith("POST /containers/create"),
    ),
  ).toBe(false);
  expect(
    fixture.requests.filter((request) => request.startsWith("GET /images/")),
  ).toHaveLength(2);
});

test("PostgreSQL creation follows successful acquisition and local image inspection", async () => {
  fixture.reset("success");
  expect(await runSetup()).toHaveProperty(
    "message",
    expect.stringContaining("reached create with verified image"),
  );
  const operations = fixture.requests
    .filter(
      (request) =>
        !request.endsWith(" /info") && !request.endsWith(" /containers/json"),
    )
    .map((request) =>
      request.startsWith("GET /images/") ? "inspect" : request,
    );
  expect(operations).toEqual([
    "inspect",
    "POST /images/create",
    "inspect",
    "POST /containers/create",
  ]);
});

test("a disconnected pull stream rejects before PostgreSQL creation", async () => {
  fixture.reset("disconnect");
  expect(await runSetup()).toHaveProperty(
    "message",
    expect.stringMatching(/aborted|socket hang up/),
  );
  expect(
    fixture.requests.some((request) =>
      request.startsWith("POST /containers/create"),
    ),
  ).toBe(false);
});

// Testcontainers caches successful image existence; keep this case after the cold-acquisition cases.
test("an inspected cached image can create PostgreSQL without another pull", async () => {
  fixture.reset("cached");
  expect(await runSetup()).toHaveProperty(
    "message",
    expect.stringContaining("reached create with verified image"),
  );
  expect(
    fixture.requests.some((request) =>
      request.startsWith("POST /images/create"),
    ),
  ).toBe(false);
});

test("a previously cached image must still exist before PostgreSQL creation", async () => {
  fixture.reset("missing-image");
  expect(await runSetup()).toHaveProperty(
    "message",
    expect.stringContaining("No such image"),
  );
  expect(
    fixture.requests.some((request) =>
      request.startsWith("POST /containers/create"),
    ),
  ).toBe(false);
});
