// @ts-check
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireLocalSetupLock } from "./local-setup-lock.mjs";
import { readStandQueue, waitForStandTurn } from "./stand-queue.mjs";

/** @param {import("node:test").TestContext} t */
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "stand-queue-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const lock = join(directory, "lock");
  /** @type {Set<number>} */
  const alive = new Set();
  /**
   * @param {number} pid
   * @param {string[]} reports
   */
  const wait = (pid, reports) => {
    alive.add(pid);
    return waitForStandTurn({
      directory,
      worktree: `/fixture/${String(pid)}`,
      command: "show",
      acquire: () => acquireLocalSetupLock("busy", lock),
      report: (message) => reports.push(message),
      pid,
      isAlive: (candidate) => alive.has(candidate),
      pause: () => new Promise((resolve) => setTimeout(resolve, 5)),
    });
  };
  return { directory, lock, alive, wait };
}

/** @param {string} directory @param {number} length */
async function untilQueued(directory, length) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if ((await readStandQueue(directory)).length === length) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Queue did not reach the expected length");
}

/** @param {() => boolean} condition */
async function until(condition) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
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
