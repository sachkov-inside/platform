import {
  afterAll,
  beforeAll,
  describe,
  expect,
  onTestFinished,
  test,
} from "vitest";

import {
  seedLocalDevelopment,
  type LocalDevelopmentSeed,
} from "../../src/development/seed-local-development.js";
import {
  createMigratedTestDatabase,
  type TestDatabase,
} from "./setup/test-database.js";

describe.each(["drain", "dispose"] as const)(
  "interrupted seed before database %s",
  (finish) => {
    let db: TestDatabase;
    let initial: LocalDevelopmentSeed;
    let resume: () => void = () => undefined;
    let disposal: Promise<void> | undefined;
    const dispose = () => (disposal ??= db.dispose());

    beforeAll(async () => {
      db = await createMigratedTestDatabase();
      initial = await db.run(() => seedLocalDevelopment(db.prisma));
    });

    afterAll(async () => {
      resume();
      await dispose();
    });

    test("finishes the repeated seed before cleanup", async () => {
      let reached: () => void = () => undefined;
      const reachedQuery = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const resumed = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const topic = new Proxy(db.prisma.topic, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (property !== "upsert" || typeof value !== "function")
            return value;
          return async (...input: readonly unknown[]): Promise<unknown> => {
            const result: unknown = await Reflect.apply(value, target, input);
            reached();
            await resumed;
            return result;
          };
        },
      });
      const prisma = new Proxy(db.prisma, {
        get(target, property) {
          if (property === "topic") return topic;
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== "function") return value;
          return (...input: readonly unknown[]): unknown =>
            Reflect.apply(value, target, input);
        },
      });
      const seed = db.run(() => seedLocalDevelopment(prisma));
      const outcome = seed.then(
        (value) => ({ ok: true, value }),
        (error: unknown) => ({ ok: false, error }),
      );
      let cleanup: Promise<void> | undefined;
      try {
        await reachedQuery;
        // The runner has ended its wait, but the seed's asynchronous body remains alive.
        cleanup = finish === "dispose" ? dispose() : db.drain();
        if (finish === "dispose") {
          await expect(db.run(() => prisma.tag.count())).rejects.toThrow(
            "Test database is disposing",
          );
        } else {
          await db.run(() => prisma.tag.count());
        }
        resume();
        expect(
          await Promise.race([
            outcome.then(() => "seed settled"),
            cleanup.then(() => "cleanup finished"),
          ]),
        ).toBe("seed settled");
        expect(await outcome).toEqual({ ok: true, value: initial });
        await cleanup;
      } finally {
        resume();
        await outcome;
        await cleanup;
      }
    });
  },
);

test("drain also waits for an operation started while it is draining", async () => {
  const db = await createMigratedTestDatabase();
  let releaseFirst: () => void = () => undefined;
  let releaseSecond: () => void = () => undefined;
  const firstBarrier = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondBarrier = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  onTestFinished(async () => {
    releaseFirst();
    releaseSecond();
    await db.dispose();
  });
  const first = db.run(() => firstBarrier);
  const drained = db.drain();
  const second = db.run(() => secondBarrier);
  let finished = false;
  void drained.then(() => {
    finished = true;
  });

  releaseFirst();
  await first;
  // A completed operation after the first one settled pins the observation to this drain.
  await db.run(() => db.prisma.$queryRaw`SELECT 1`);
  expect(finished).toBe(false);
  releaseSecond();
  await second;
  await drained;
  expect(finished).toBe(true);
});
