// deterministic-test-allow unit-io: benign owned Node child proves PID/signal/cleanup harness only; root supervisor reaps descendants in finally.
import { createServer } from "node:net";
import { once } from "node:events";
import { reservePort } from "../../../../scripts/smoke-stand.mjs";
import { expect, it } from "vitest";
import { launchTelegramMain } from "../support/telegram-main-process.js";

it("signals only its verified pinned Node child and waits for supervised exit", async () => {
  const child = launchTelegramMain({
    entrypoint: new URL("../support/telegram-main-benign.mjs", import.meta.url),
    environment: {},
    readiness: "owned benign child ready",
  });
  try {
    const fact = await child.identity;
    expect(fact.node).toBe("v26.10.0");
    expect(fact.pid).toBeGreaterThan(1);
    await child.ready;
    child.signal();
    expect(await child.exited).toEqual([0, null]);
    expect(child.outputOverflow()).toBe(false);
    expect(child.hasExited()).toBe(true);
  } finally {
    await child.stop();
  }
});

it("withholds raw missing-entrypoint diagnostics and reports supervised failure", async () => {
  const child = launchTelegramMain({
    entrypoint: new URL("../support/absent-owned-main.mjs", import.meta.url),
    environment: {},
    readiness: "owned benign child ready",
  });
  try {
    await child.identity;
    await expect(child.ready).rejects.toThrow(
      "Telegram child exited before readiness",
    );
    expect(await child.exited).toEqual([1, null]);
    expect(child.hasExited()).toBe(true);
    expect(child.outputOverflow()).toBe(false);
  } finally {
    await child.stop();
  }
});

it("settles a failed supervisor acquisition without retaining OS diagnostics", async () => {
  const child = launchTelegramMain({
    entrypoint: new URL("../support/telegram-main-benign.mjs", import.meta.url),
    environment: { PATH: "/absent-owned-runtime-path" },
    readiness: "owned benign child ready",
  });
  try {
    await expect(child.identity).rejects.toThrow(
      "Telegram child exited before identity",
    );
    await expect(child.ready).rejects.toThrow(
      "Telegram child exited before readiness",
    );
    expect(child.hasExited()).toBe(true);
    expect(await child.exited).toEqual([null, null]);
  } finally {
    await child.stop();
  }
});

it("reaps an admitted benign child when the harness is interrupted", async () => {
  const child = launchTelegramMain({
    entrypoint: new URL("../support/telegram-main-benign.mjs", import.meta.url),
    environment: {},
    readiness: "owned benign child ready",
  });
  try {
    await child.identity;
    await child.ready;
    await child.stop();
    expect(child.hasExited()).toBe(true);
    // The supervisor reports its intentional stop as143, separately from normal child exit.
    expect(await child.exited).toEqual([143, null]);
  } finally {
    await child.stop();
  }
});

it("fails on its owned occupied port and starts on a distinct reserved port", async () => {
  const occupied = createServer();
  try {
    occupied.listen(0, "127.0.0.1");
    await once(occupied, "listening");
    const address = occupied.address();
    if (address === null || typeof address === "string")
      throw new Error("Owned occupied listener unavailable");
    for (const kind of ["occupied", "free"] as const) {
      const port = kind === "occupied" ? address.port : await reservePort();
      const child = launchTelegramMain({
        entrypoint: new URL(
          "../support/telegram-main-benign.mjs",
          import.meta.url,
        ),
        environment: { PORT: String(port) },
        readiness: "owned benign child ready",
      });
      try {
        await child.identity;
        if (kind === "occupied") {
          await expect(child.ready).rejects.toThrow(
            "Telegram child exited before readiness",
          );
          expect(await child.exited).toEqual([1, null]);
        } else {
          await child.ready;
          child.signal();
          expect(await child.exited).toEqual([0, null]);
        }
        expect(child.outputOverflow()).toBe(false);
        expect(child.hasExited()).toBe(true);
      } finally {
        await child.stop();
      }
    }
  } finally {
    if (occupied.listening)
      await new Promise<void>((resolve, reject) =>
        occupied.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
  }
});
