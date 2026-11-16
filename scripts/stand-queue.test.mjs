// @ts-check
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";
import {
  processStartTime,
  readStandQueue,
  waitForStandTurn,
} from "./stand-queue.mjs";

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "stand-queue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lock = join(directory, "lock");
  /** @type {Set<number>} */
  const alive = new Set();
  /** @type {Map<number, string>} what the system reports as the start time of each process */
  const started = new Map();
  /**
   * @param {number} pid
   * @param {string[]} reports
   */
  const wait = (pid, reports) => {
    alive.add(pid);
    if (!started.has(pid)) started.set(pid, "2026-11-16T10:00:00.000Z");
    return waitForStandTurn({
      directory,
      worktree: `/fixture/${String(pid)}`,
      command: "show",
      acquire: () => acquireLocalSetupLock("busy", lock),
      report: (message) => reports.push(message),
      pid,
      isAlive: (candidate) => alive.has(candidate),
      startTime: (candidate) => started.get(candidate),
      pause,
    });
  };
  return { directory, lock, alive, started, wait };
}

const pollAttempts = 2_000;
const pollMilliseconds = 5;

function pause() {
  // deterministic-test-allow duration-wait: polling a fact (the queue directory and reports of real waiters); the attempt bound only fails a stuck queue.
  return new Promise((resolve) => setTimeout(resolve, pollMilliseconds));
}

/** @param {string} directory @param {number} length */
async function untilQueued(directory, length) {
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    if ((await readStandQueue(directory)).length === length) return;
    await pause();
  }
  throw new Error("Queue did not reach the expected length");
}

/** @param {() => boolean} condition */
async function until(condition) {
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    if (condition()) return;
    await pause();
  }
  throw new Error("Condition was not reached");
}

test("a busy stand queues operations in arrival order and reports each position", async (t) => {
  const { wait } = await fixture(t);
  /** @type {string[]} */
  const first = [];
  /** @type {string[]} */
  const second = [];
  /** @type {string[]} */
  const third = [];
  /** @type {number[]} */
  const order = [];
  const releaseFirst = await wait(101, first);
  const secondTurn = wait(102, second).then((release) => {
    order.push(102);
    return release;
  });
  await until(() => second.length > 0);
  const thirdTurn = wait(103, third).then((release) => {
    order.push(103);
    return release;
  });
  await until(() => third.length > 0);

  assert.deepEqual(first, []);
  assert.match(second[0] ?? "", /position 2 of 2.*\/fixture\/101 show/u);
  assert.match(third[0] ?? "", /position 3 of 3/u);

  await releaseFirst();
  const releaseSecond = await secondTurn;
  await until(() => third.some((line) => /position 2 of 2/u.test(line)));
  assert.deepEqual(order, [102]);
  await releaseSecond();
  const releaseThird = await thirdTurn;
  assert.deepEqual(order, [102, 103]);
  await releaseThird();
});

test("the queue skips a waiter whose process has ended", async (t) => {
  const { wait, alive, directory } = await fixture(t);
  const releaseFirst = await wait(201, []);
  const abandoned = wait(202, []).then(
    () => assert.fail("An abandoned waiter got the stand"),
    (/** @type {unknown} */ error) => error,
  );
  await untilQueued(directory, 2);
  /** @type {string[]} */
  const reports = [];
  const turn = wait(203, reports);
  await until(() => reports.length > 0);
  assert.match(reports[0] ?? "", /position 3 of 3/u);

  alive.delete(202);
  await releaseFirst();
  const release = await turn;
  const failure = await abandoned;
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /queue ticket was removed/u);
  await release();
});

test("the queue skips a killed waiter whose process ID now belongs to another process", async (t) => {
  const { wait, started, directory } = await fixture(t);
  const releaseFirst = await wait(601, []);
  const killed = wait(602, []).then(
    () => assert.fail("A killed waiter got the stand"),
    (/** @type {unknown} */ error) => error,
  );
  await untilQueued(directory, 2);
  /** @type {string[]} */
  const reports = [];
  const turn = wait(603, reports);
  await until(() => reports.length > 0);
  assert.match(reports[0] ?? "", /position 3 of 3/u);

  // The process ID stays alive, but the system started that process later: it is another process.
  started.set(602, "2026-11-16T12:30:00.000Z");
  await until(() => reports.some((line) => /position 2 of 2/u.test(line)));
  await releaseFirst();
  const release = await turn;
  const failure = await killed;
  assert.ok(failure instanceof Error);
  assert.match(failure.message, /queue ticket was removed/u);
  assert.equal((await readStandQueue(directory)).length, 1);
  await release();
});

test("a ticket written before start times were recorded keeps its place while its process ID is alive", async (t) => {
  const { wait, alive, started, directory } = await fixture(t);
  const queue = join(directory, "queue");
  await mkdir(queue, { recursive: true });
  alive.add(701);
  started.set(701, "2026-11-16T09:00:00.000Z");
  await writeFile(
    join(queue, "000000000000000001-earlier-format.json"),
    JSON.stringify({
      pid: 701,
      worktree: "/fixture/earlier-format",
      command: "refresh",
      enqueuedAt: new Date(0).toISOString(),
    }),
  );
  /** @type {string[]} */
  const reports = [];
  const turn = wait(702, reports);
  await until(() => reports.length > 0);
  assert.match(
    reports[0] ?? "",
    /position 2 of 2.*\/fixture\/earlier-format refresh/u,
  );

  alive.delete(701);
  const release = await turn;
  await release();
  assert.deepEqual(await readdir(queue), []);
});

test("a ticket keeps its place when a second reading of its start time differs by one second", async (t) => {
  const { wait, started, directory } = await fixture(t);
  const releaseFirst = await wait(851, []);
  started.set(851, "2026-11-16T10:00:01.000Z");
  /** @type {string[]} */
  const reports = [];
  const turn = wait(852, reports);
  await until(() => reports.length > 0);
  assert.match(reports[0] ?? "", /position 2 of 2.*\/fixture\/851 show/u);
  assert.equal((await readStandQueue(directory)).length, 2);
  await releaseFirst();
  await (
    await turn
  )();
});

test("a ticket keeps its place while the start time of its live process cannot be read", async (t) => {
  const { wait, alive, started, directory } = await fixture(t);
  const releaseFirst = await wait(801, []);
  /** @type {string[]} */
  const reports = [];
  let granted = false;
  const turn = wait(802, reports).then((release) => {
    granted = true;
    return release;
  });
  await until(() => reports.length > 0);
  started.delete(801);
  /** @type {string[]} */
  const later = [];
  const laterTurn = wait(803, later);
  await until(() => later.length > 0);
  assert.match(later[0] ?? "", /position 3 of 3.*\/fixture\/801 show/u);
  assert.equal(granted, false);
  assert.equal(alive.has(801), true);
  assert.equal((await readStandQueue(directory)).length, 3);
  await releaseFirst();
  await (
    await turn
  )();
  await (
    await laterTurn
  )();
});

test("the system reports one start time for a running process and none for a missing one", () => {
  const first = processStartTime(process.pid);
  assert.match(first ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/u);
  const age = Date.now() - Date.parse(first ?? "");
  assert.ok(
    age >= 0 && age < 3_600_000,
    `start time ${String(first)} is not recent`,
  );
  assert.equal(processStartTime(process.pid), first);
  assert.equal(processStartTime(2 ** 30), undefined);
});

test("status lists the waiting operations without the start time of their processes", async (t) => {
  const { wait, directory } = await fixture(t);
  const release = await wait(901, []);
  const [entry] = await readStandQueue(directory);
  assert.deepEqual(Object.keys(entry ?? {}).sort(), [
    "command",
    "enqueuedAt",
    "pid",
    "worktree",
  ]);
  await release();
});

test("the head of the queue waits for a holder of the machine-wide lock outside the queue", async (t) => {
  const { wait, lock, directory } = await fixture(t);
  const outside = await acquireLocalSetupLock("busy", lock);
  /** @type {string[]} */
  const reports = [];
  let granted = false;
  const turn = wait(301, reports).then((release) => {
    granted = true;
    return release;
  });
  await until(() => reports.length > 0);
  assert.match(reports[0] ?? "", /another local setup operation/u);
  assert.equal(granted, false);
  await outside();
  const release = await turn;
  assert.equal((await readStandQueue(directory)).length, 1);
  await release();
  assert.deepEqual(await readStandQueue(directory), []);
});

test("a ticket of a finished process and an unreadable ticket are removed", async (t) => {
  const { wait, directory } = await fixture(t);
  const queue = join(directory, "queue");
  const release = await wait(401, []);
  await release();
  await writeFile(
    join(queue, "000000000000000001-dead.json"),
    JSON.stringify({
      pid: 999_999,
      worktree: "/fixture/dead",
      command: "show",
      enqueuedAt: new Date(0).toISOString(),
    }),
  );
  await writeFile(join(queue, "000000000000000002-broken.json"), "{");
  const next = await wait(402, []);
  await next();
  assert.deepEqual(await readdir(queue), []);
});

test("status lists the waiting operations in order", async (t) => {
  const { wait, directory } = await fixture(t);
  const release = await wait(501, []);
  const pending = wait(502, []);
  await untilQueued(directory, 2);
  const queue = await readStandQueue(directory);
  assert.deepEqual(
    queue.map((entry) => [entry.worktree, entry.command]),
    [
      ["/fixture/501", "show"],
      ["/fixture/502", "show"],
    ],
  );
  await release();
  await (
    await pending
  )();
});
