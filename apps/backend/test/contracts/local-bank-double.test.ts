import { fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, onTestFinished, test } from "vitest";

import { localTbankConfig } from "../../src/config/tbank-config.js";
import { createLocalBankDouble } from "../../src/development/bank-double/local-bank-double.js";
import { Tbank } from "../../src/modules/billing/infrastructure/tbank/tbank.js";
import { startLocalBankDouble } from "../../src/development/bank-double/start-local-bank-double.js";

const config = localTbankConfig({});

describe("local bank double process/HTTP contracts", () => {
  test("журнал переживает перезапуск двойника", async () => {
    const directory = mkdtempSync(join(tmpdir(), "inside-bank-double-"));
    onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
    const ledgerPath = join(directory, "ledger.json");
    function openLedger() {
      const double = createLocalBankDouble({
        config,
        ledgerPath,
        notify: () => Promise.resolve(),
      });
      const bank = new Tbank(config, (url, init) =>
        double.handle(new Request(url, init)),
      );
      return { bank, double };
    }
    const first = openLedger();
    const orderId = "0f2f7c0e-6d9e-4d23-9c0e-1f3c6f1c2f01";
    const started = await first.bank.init({
      orderId,
      accountId: "buyer-1",
      amount: 290_000,
      name: "Руководство «Стенд»",
      email: "buyer@example.test",
    });
    await first.double.handle(
      new Request(started.PaymentURL, {
        method: "POST",
        body: new URLSearchParams({ outcome: "confirmed" }),
      }),
    );
    const restarted = openLedger();
    expect(await restarted.bank.order(orderId)).toEqual([started.PaymentId]);
    expect(await restarted.bank.state(started.PaymentId)).toMatchObject({
      Status: "CONFIRMED",
      Success: true,
    });
  });

  // Build runs before Vitest; this barrier ends on process close, with no cold compiler in the case.
  test("вне стенда двойник не запускается и говорит об этом", async () => {
    const child = fork(
      new URL("../../dist/development/bank-double.js", import.meta.url),
      [],
      {
        execArgv: [],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        env: {
          ...process.env,
          NODE_ENV: "production",
          TBANK_PROVIDER_MODE: "test",
        },
      },
    );
    const closed = new Promise<number | null>((resolve) =>
      child.once("close", resolve),
    );
    onTestFinished(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await closed;
    });
    let reported = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      reported += chunk.toString("utf8");
    });
    try {
      const code = await closed;
      expect(code).toBe(1);
      expect(reported).toContain(
        "The local bank double runs only with NODE_ENV=development",
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      await closed;
    }
  }, 30_000);

  test("сетевая оболочка отвечает тем же двойником", async () => {
    const running = await startLocalBankDouble({
      config,
      host: "127.0.0.1",
      port: 0,
    });
    try {
      const health = await fetch(`http://127.0.0.1:${running.port}/health`);
      expect(await health.json()).toMatchObject({
        process: "bank-double",
        status: "ready",
        terminal: config.terminalKey,
      });
      const page = await fetch(`http://127.0.0.1:${running.port}/`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Двойник банка Inside");
    } finally {
      await running.close();
    }
  });
});
