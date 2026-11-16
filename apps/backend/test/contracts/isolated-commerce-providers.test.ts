import { fork } from "node:child_process";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import { expect, onTestFinished, test } from "vitest";
import { z } from "zod";
import { reservePort } from "../../../../scripts/smoke-stand.mjs";

async function configuration(): Promise<NodeJS.ProcessEnv> {
  const bank = await reservePort();
  const telegram = await reservePort();
  return {
    NODE_ENV: "development",
    DATABASE_URL:
      "postgresql://inside:inside@127.0.0.1:9/inside_light_0123456789",
    TBANK_PROVIDER_MODE: "test",
    TBANK_TEST_API_BASE_URL: `http://127.0.0.1:${bank}/v2`,
    TBANK_TEST_PUBLIC_ORIGIN: `http://127.0.0.1:${bank}`,
    TBANK_TEST_NOTIFICATION_URL:
      "http://127.0.0.1:9/billing/tbank/notification",
    TBANK_TEST_RETURN_URL: "http://127.0.0.1:9/payment/return",
    ISOLATED_TELEGRAM_PORT: String(telegram),
  };
}

function launch(environment: NodeJS.ProcessEnv) {
  const child = fork(
    new URL(
      "../../dist/development/isolated-commerce-providers.js",
      import.meta.url,
    ),
    [],
    {
      execArgv: [],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      env: environment,
    },
  );
  const closed = new Promise<number | null>((resolve) =>
    child.once("close", resolve),
  );
  let diagnostic = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    diagnostic += chunk.toString("utf8");
  });
  onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
    await closed;
  });
  return { child, closed, diagnostic: () => diagnostic };
}

for (const refusal of [
  {
    name: "production",
    overrides: { NODE_ENV: "production" },
    message: "NODE_ENV=development",
  },
  {
    name: "ordinary database",
    overrides: {
      DATABASE_URL: "postgresql://inside:inside@127.0.0.1:9/inside",
    },
    message: "isolated light database",
  },
  {
    name: "real terminal",
    overrides: { TBANK_CONFIG_JSON: "{}" },
    message: "local test bank only",
  },
  {
    name: "external bank address",
    overrides: {
      TBANK_TEST_API_BASE_URL: "https://must-not-connect.invalid/v2",
    },
    message: "owned loopback addresses",
  },
]) {
  test(`commerce providers refuse ${refusal.name} before opening sockets`, async () => {
    const running = launch({
      ...(await configuration()),
      ...refusal.overrides,
    });
    expect(await running.closed).toBe(1);
    expect(running.diagnostic()).toContain(refusal.message);
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  test(`commerce providers answer on both owned ports and close on ${signal}`, async () => {
    const environment = await configuration();
    const running = launch(environment);
    expect(running.child.stdout).not.toBeNull();
    if (running.child.stdout === null)
      throw new Error("Missing provider output");
    const lines = createInterface({ input: running.child.stdout });
    let ready = false;
    for await (const line of lines) {
      z.object({
        process: z.literal("isolated-commerce-providers"),
        status: z.literal("ready"),
      }).parse(JSON.parse(line));
      ready = true;
      break;
    }
    expect(ready, running.diagnostic()).toBe(true);
    const bank = new URL("/health", environment["TBANK_TEST_API_BASE_URL"]);
    const telegram = `http://127.0.0.1:${environment["ISOLATED_TELEGRAM_PORT"]}/health`;
    expect((await fetch(bank)).status).toBe(200);
    expect((await fetch(telegram)).status).toBe(200);
    running.child.kill(signal);
    expect(await running.closed).toBe(0);
    await expect(fetch(bank)).rejects.toThrow();
    await expect(fetch(telegram)).rejects.toThrow();
  });
}

test("a bank bind failure also closes the already started Telegram provider", async () => {
  const environment = await configuration();
  const occupied = createServer();
  await new Promise<void>((resolve) =>
    occupied.listen(
      Number(new URL(environment["TBANK_TEST_API_BASE_URL"] ?? "").port),
      "127.0.0.1",
      resolve,
    ),
  );
  onTestFinished(
    () => new Promise<void>((resolve) => occupied.close(() => resolve())),
  );
  const running = launch(environment);
  expect(await running.closed).toBe(1);
  expect(running.diagnostic()).toContain("EADDRINUSE");
  await expect(
    fetch(`http://127.0.0.1:${environment["ISOLATED_TELEGRAM_PORT"]}/health`),
  ).rejects.toThrow();
});
