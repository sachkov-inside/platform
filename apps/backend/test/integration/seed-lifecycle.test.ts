import { expect, test } from "vitest";

import { seedLocalDevelopment } from "../../src/development/seed-local-development.js";
import { createMigratedTestDatabase } from "./setup/test-database.js";

test.each(["drain", "dispose"] as const)(
  "interrupted seed finishes before database %s",
  async (finish) => {
    const db = await createMigratedTestDatabase();
    const initial = await db.run(() => seedLocalDevelopment(db.prisma));
    let reached: () => void = () => undefined;
    let resume: () => void = () => undefined;
    const reachedQuery = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const topic = new Proxy(db.prisma.topic, {
      get(target, property) {
        const value: unknown = Reflect.get(target, property, target);
        if (property !== "upsert" || typeof value !== "function") return value;
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
      cleanup = db[finish]();
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
      if (finish === "drain" || cleanup === undefined) await db.dispose();
    }
  },
);
