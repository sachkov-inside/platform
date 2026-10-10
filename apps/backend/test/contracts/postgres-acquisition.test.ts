import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, onTestFinished, test } from "vitest";

const backendRoot = fileURLToPath(new URL("../..", import.meta.url));
const supervisor = fileURLToPath(
  new URL("../../../../scripts/owned-node.mjs", import.meta.url),
);
let compiledDirectory: string | undefined;
afterAll(async () => {
  if (compiledDirectory !== undefined)
    await rm(compiledDirectory, { recursive: true, force: true });
});
// Prepare one immutable JavaScript corpus before any acquisition case starts.
beforeAll(async () => {
  const cache = join(backendRoot, "node_modules/.cache");
  await mkdir(cache, { recursive: true });
  compiledDirectory = await mkdtemp(join(cache, "postgres-acquisition-"));
  const config = join(compiledDirectory, "tsconfig.json");
  await writeFile(
    config,
    JSON.stringify({
      extends: fileURLToPath(
        new URL("../../../../tsconfig.nest-app.json", import.meta.url),
      ),
      compilerOptions: {
        incremental: false,
        sourceMap: false,
        rootDir: backendRoot,
        outDir: compiledDirectory,
      },
      files: [
        fileURLToPath(
          new URL("./fixtures/postgres-acquisition.mts", import.meta.url),
        ),
      ],
      include: [],
    }),
  );
  const compile = spawnSync(
    process.execPath,
    [
      supervisor,
      join(backendRoot, "node_modules/typescript/bin/tsc"),
      "--project",
      config,
    ],
    { encoding: "utf8", timeout: 30_000 },
  );
  expect(compile.error).toBeUndefined();
  expect(compile.status, `${compile.stdout}${compile.stderr}`).toBe(0);
}, 35_000);

type Scenario =
  | "stream-error"
  | "detail-error"
  | "http-error"
  | "missing-image"
  | "success"
  | "cached"
  | "cached-disappears"
  | "disconnect"
  | "open-error"
  | "null-event";

async function assembleDockerFixture(initialScenario: Scenario) {
  let scenario = initialScenario;
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
      } else if (scenario === "open-error" || scenario === "null-event") {
        streamClosed = new Promise<void>((resolve) =>
          response.once("close", resolve),
        );
        response.write(
          scenario === "null-event"
            ? "null\n"
            : `${JSON.stringify({ error: primaryError })}\n`,
        );
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
      ((scenario === "success" && pulled) ||
        scenario === "cached" ||
        scenario === "cached-disappears")
    ) {
      verified = true;
      response.end(JSON.stringify({ Id: "sha256:fixture" }));
    } else if (path === "/containers/create" && verified) {
      if (scenario === "cached-disappears") {
        scenario = "missing-image";
        verified = false;
      }
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
  onTestFinished(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) =>
        error === undefined ? resolve() : reject(error),
      ),
    );
    expect(server.listening).toBe(false);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Fixture did not bind TCP");
  return {
    requests,
    primaryError,
    closed: () => streamClosed,
    dockerHost: `tcp://127.0.0.1:${address.port}`,
  };
}

// Each process owns a fresh Testcontainers runtime; the standard supervisor cleans its whole tree.
async function runSetup(
  fixture: Awaited<ReturnType<typeof assembleDockerFixture>>,
  runs = 1,
) {
  if (compiledDirectory === undefined)
    throw new Error("Fixture compilation did not complete");
  // deterministic-test-allow process-cleanup: owned-node supervises descendants; finally/onTestFinished stop it and await close, including the crashing null-event fixture.
  const child = spawn(
    process.execPath,
    [
      supervisor,
      join(
        compiledDirectory,
        "test/contracts/fixtures/postgres-acquisition.mjs",
      ),
      String(runs),
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DOCKER_HOST: fixture.dockerHost,
        DOCKER_TLS_VERIFY: "0",
        TESTCONTAINERS_HOST_OVERRIDE: "127.0.0.1",
        TESTCONTAINERS_RYUK_DISABLED: "true",
        DOCKER_AUTH_CONFIG: '{"auths":{}}',
      },
    },
  );
  const closed = new Promise<void>((resolve) => child.once("close", resolve));
  const cleanup = async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    await closed;
  };
  onTestFinished(cleanup);
  let output = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: unknown) => {
    if (typeof chunk === "string") output += chunk;
  });
  child.stderr.on("data", (chunk: unknown) => {
    if (typeof chunk === "string") stderr += chunk;
  });
  try {
    const exit = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    expect(exit, stderr).toBe(0);
    expect(output).not.toContain("unexpectedly");
    return output;
  } finally {
    await cleanup();
  }
}

function expectNoCreate(requests: readonly string[]) {
  expect(
    requests.some((request) => request.startsWith("POST /containers/create")),
  ).toBe(false);
}

test.each(["stream-error", "detail-error", "http-error"] as const)(
  "PostgreSQL setup preserves %s before container creation",
  async (scenario) => {
    const fixture = await assembleDockerFixture(scenario);
    expect(await runSetup(fixture)).toContain(fixture.primaryError);
    expect(
      fixture.requests.some((request) =>
        request.startsWith("POST /images/create"),
      ),
    ).toBe(true);
    expectNoCreate(fixture.requests);
  },
);

test("a failed acquisition closes its unfinished pull stream without replacing the error", async () => {
  const fixture = await assembleDockerFixture("open-error");
  expect(await runSetup(fixture)).toContain(fixture.primaryError);
  await fixture.closed();
  expectNoCreate(fixture.requests);
});

test("a completed pull without a local image cannot create PostgreSQL", async () => {
  const fixture = await assembleDockerFixture("missing-image");
  expect(await runSetup(fixture)).toContain("No such image");
  expectNoCreate(fixture.requests);
  expect(
    fixture.requests.filter((request) => request.startsWith("GET /images/")),
  ).toHaveLength(2);
});

test("PostgreSQL creation follows successful acquisition and local image inspection", async () => {
  const fixture = await assembleDockerFixture("success");
  expect(await runSetup(fixture)).toContain(
    "reached create with verified image",
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
  const fixture = await assembleDockerFixture("disconnect");
  expect(await runSetup(fixture)).toMatch(/aborted|socket hang up/);
  expectNoCreate(fixture.requests);
});

test("an inspected cached image can create PostgreSQL without another pull", async () => {
  const fixture = await assembleDockerFixture("cached");
  expect(await runSetup(fixture)).toContain(
    "reached create with verified image",
  );
  expect(
    fixture.requests.some((request) =>
      request.startsWith("POST /images/create"),
    ),
  ).toBe(false);
});

test("a previously cached image must still exist before PostgreSQL creation", async () => {
  const fixture = await assembleDockerFixture("cached-disappears");
  const output = await runSetup(fixture, 2);
  expect(output).toContain("reached create with verified image");
  expect(output).toContain("No such image");
  expect(
    fixture.requests.filter((request) =>
      request.startsWith("POST /containers/create"),
    ),
  ).toHaveLength(1);
  expect(
    fixture.requests.some((request) =>
      request.startsWith("POST /images/create"),
    ),
  ).toBe(false);
});

test("an invalid pull event rejects acquisition and closes the stream", async () => {
  const fixture = await assembleDockerFixture("null-event");
  expect(await runSetup(fixture)).toContain("Invalid Docker pull event");
  await fixture.closed();
  expectNoCreate(fixture.requests);
});
