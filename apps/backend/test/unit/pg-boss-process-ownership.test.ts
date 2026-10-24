// deterministic-test-allow unit-io: owned loopback process contracts; external Python supervisor reaps the fixture after timeout and owner SIGKILL.
import { spawn } from "node:child_process";
import { once } from "node:events";
// deterministic-test-allow unit-io: probe only the owned loopback socket; destroy it in finally.
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  boundedProcessFact,
  finishFixtureCleanup,
  launchQueueTelemetryProcess,
} from "../integration/setup/queue-telemetry-process.js";
import { eventually } from "../integration/setup/eventually.js";

const EXIT_DEADLINE_MS = 50;
const READY_DEADLINE_MS = 5_000;
const CLEANUP_DEADLINE_MS = 10_000;
// The external supervisor uses its existing five-second SIGTERM grace after owner loss.
const OWNER_CONTRACT_BUDGET_MS = 30_000;
const ownedState = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
});

async function assertGone(state: z.infer<typeof ownedState>): Promise<void> {
  await eventually(() => {
    expect(() => process.kill(state.pid, 0)).toThrow();
    return Promise.resolve();
  }, CLEANUP_DEADLINE_MS);
  const socket = createConnection({ host: "127.0.0.1", port: state.port });
  try {
    const error: unknown = await boundedProcessFact(
      once(socket, "error"),
      CLEANUP_DEADLINE_MS,
    );
    expect(
      z.tuple([z.object({ code: z.literal("ECONNREFUSED") })]).safeParse(error)
        .success,
    ).toBe(true);
  } finally {
    socket.destroy();
  }
}

function interruptSupervisor(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ESRCH"
    )
      throw error;
  }
}

describe("queue telemetry fixture ownership", () => {
  it(
    "bounds a missing exit and closes its command group and inherited socket",
    async () => {
      const owned = launchQueueTelemetryProcess({
        databaseUrl: "unused",
        endpoint: "unused",
        mode: "ownership",
      });
      let state: z.infer<typeof ownedState> | undefined;
      try {
        state = ownedState.parse(
          await boundedProcessFact(owned.firstMessage, READY_DEADLINE_MS),
        );
        expect(state.pid).not.toBe(owned.child.pid);
        await expect(
          boundedProcessFact(owned.exited, EXIT_DEADLINE_MS),
        ).rejects.toThrow("queue fixture process deadline");
      } finally {
        await owned.stop();
      }
      await assertGone(state);
    },
    OWNER_CONTRACT_BUDGET_MS,
  );

  it(
    "external supervisor reaps a live fixture after the Vitest-like owner is SIGKILLed",
    async () => {
      // deterministic-test-allow process-cleanup: only this launcher is killed directly; its independent spawnOwned supervisor owns the command group. Finally signals the registered supervisor and bounds launcher exit; assertions verify descendant reaping and socket closure.
      const owner = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          fileURLToPath(
            new URL(
              "../integration/fixtures/pg-boss-telemetry-owner.ts",
              import.meta.url,
            ),
          ),
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const exited = once(owner, "exit");
      void exited.catch(() => undefined);
      owner.stderr.resume();
      const lines = createInterface({ input: owner.stdout });
      let state:
        (z.infer<typeof ownedState> & { supervisorPid: number }) | undefined;
      let cleaned = false;
      try {
        const lineEvent: unknown = await boundedProcessFact(
          once(lines, "line"),
          READY_DEADLINE_MS,
        );
        const [line] = z.tuple([z.string()]).parse(lineEvent);
        state = ownedState
          .extend({ supervisorPid: z.number().int().positive() })
          .parse(JSON.parse(line));
        expect(state.supervisorPid).not.toBe(owner.pid);
        owner.kill("SIGKILL");
        expect(await boundedProcessFact(exited, CLEANUP_DEADLINE_MS)).toEqual([
          null,
          "SIGKILL",
        ]);
        await assertGone(state);
        cleaned = true;
      } finally {
        await finishFixtureCleanup([
          () => {
            lines.close();
            if (owner.exitCode === null && owner.signalCode === null)
              owner.kill("SIGKILL");
          },
          () => {
            if (state !== undefined && !cleaned)
              interruptSupervisor(state.supervisorPid);
          },
          () => boundedProcessFact(exited, CLEANUP_DEADLINE_MS),
        ]);
      }
    },
    OWNER_CONTRACT_BUDGET_MS,
  );
});
