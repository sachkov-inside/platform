import { expect, it } from "vitest";
import {
  decodePgBossWorkObservations,
  unknownPgBossWork,
} from "../../src/infrastructure/pg-boss-work-observation.js";

const asOf = new Date("2026-10-27T12:00:00.000Z");
const previous = {
  queue: "billing.payment-recovery",
  worker: "billing-worker",
  recordedAt: new Date("2026-10-27T11:55:00.000Z"),
  handlerReturnedAt: new Date("2026-10-27T11:55:00.000Z"),
  release: "v1566",
  sourceSha: "a".repeat(40),
} as const;

it("distinguishes no history, recent committed handler work and an old observation without inferring ACK or liveness", () => {
  expect(
    decodePgBossWorkObservations([], asOf).get(previous.queue),
  ).toBeUndefined();
  expect(unknownPgBossWork).toEqual({
    status: "unknown",
    reason: "no_history",
    at: null,
    ageSeconds: null,
    release: null,
  });
  const recent = decodePgBossWorkObservations([previous], asOf).get(
    previous.queue,
  );
  expect(
    decodePgBossWorkObservations([{ ...previous, recordedAt: asOf }], asOf).get(
      previous.queue,
    )?.ageSeconds,
  ).toBe(300);
  expect(recent).toEqual({
    status: "known",
    meaning: "handler_result_committed",
    worker: "billing-worker",
    at: "2026-10-27T11:55:00.000Z",
    observedAt: "2026-10-27T11:55:00.000Z",
    clock: "process_wall_clock",
    ageSeconds: 300,
    freshness: "recent",
    release: { release: "v1566", sourceSha: "a".repeat(40) },
    nativeAck: "not_proven",
    externalEffect: "not_proven",
  });
  expect(
    decodePgBossWorkObservations(
      [previous],
      new Date("2026-10-27T12:00:00.001Z"),
    ).get(previous.queue)?.freshness,
  ).toBe("stale");
});

it("refuses overflowing, duplicate, foreign, future or malformed observations before returning any partial source", () => {
  const invalid: readonly unknown[] = [
    Array.from({ length: 11 }, () => previous),
    [previous, previous],
    [{ ...previous, queue: "foreign-private-queue" }],
    [{ ...previous, worker: "material-assets-worker" }],
    [{ ...previous, recordedAt: new Date("2026-10-27T12:00:00.001Z") }],
    [{ ...previous, recordedAt: new Date(Number.NaN) }],
    [{ ...previous, recordedAt: new Date(0) }],
    [{ ...previous, handlerReturnedAt: new Date("2026-10-27T11:55:00.001Z") }],
    [{ ...previous, release: "v9007199254740992" }],
    [{ ...previous, sourceSha: "private-value" }],
    [{ ...previous, private: "never-exported" }],
  ];
  for (const rows of invalid)
    expect(() => decodePgBossWorkObservations(rows, asOf)).toThrow();
  expect(() =>
    decodePgBossWorkObservations([previous], new Date(Number.NaN)),
  ).toThrow();
});
