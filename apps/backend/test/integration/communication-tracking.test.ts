import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { Prisma } from "../../src/infrastructure/prisma/index.js";
import { TrackVisit, isSafeTrackingTarget } from "../../src/modules/communications/features/track-visit/track-visit.js";
import { HttpCommunicationsProvider } from "../../src/modules/communications/infrastructure/http-communications-provider.js";
import { requestSchema } from "../../src/modules/communications/communications-schema.generated.js";
import { createMigratedTestDatabase, type TestDatabase } from "./setup/test-database.js";
const origin = "https://inside.test";
const token = "a".repeat(43);
const config = { endpoint: "https://telegram.test/integrations/platform/v1/communications", secret: "synthetic-secret", authorizationSecret: "synthetic-authorization", botIdentity: "test-bot" };
const received = new Map<string, unknown>();
const calls: unknown[] = [];
let database: TestDatabase;
let now: Date;
let outage = false;
let loseAck = false;
let target = `${origin}/materials/test-guide`;
const fetcher: typeof fetch = (_url, init) => {
  if (typeof init?.body !== "string") throw new Error("Expected serialized envelope");
  const body: unknown = JSON.parse(init.body);
  const request = requestSchema.parse(body);
  if (request.operation === "tracking.resolve") return Promise.resolve(Response.json({ contractVersion: "inside-communications-v1", status: "ok", safeUrl: target }));
  if (request.operation !== "tracking.recordHit") throw new Error("Unexpected operation");
  calls.push(body);
  if (outage) return Promise.reject(new Error("Provider down"));
  const duplicate = received.has(request.payload.eventId);
  if (duplicate) expect(received.get(request.payload.eventId)).toEqual(body);
  received.set(request.payload.eventId, body);
  if (loseAck) return Promise.reject(new Error("Lost ACK after commit"));
  return Promise.resolve(Response.json({ contractVersion: "inside-communications-v1", status: "ok", eventId: request.payload.eventId, outcome: duplicate ? "duplicate" : "recorded" }));
};
const provider = new HttpCommunicationsProvider(config, fetcher);
function visits() { return new TrackVisit(database.prisma, provider, origin, undefined, () => now); }
beforeAll(async () => { database = await createMigratedTestDatabase(); });
afterAll(async () => { await database?.dispose(); });
beforeEach(async () => { await database.prisma.communicationTrackingHit.deleteMany(); received.clear(); calls.length = 0; now = new Date(); outage = false; loseAck = false; target = `${origin}/materials/test-guide`; });

test("safe target only, opaque tokens and invalid provider destinations never create events", async () => {
  expect(await visits().resolve({ token: "bad", traffic: "unknown" })).toEqual({ kind: "invalid" });
  for (const value of ["https://evil.test/materials/guide", `${origin}/api/authoring`, `${origin}/materials/guide?redirect=evil`, `${origin}/materials/%2f%2fevil`, `https://user@inside.test/materials/guide`, `${origin}/materials/guide#fragment`]) {
    target = value;
    expect(isSafeTrackingTarget(value, origin)).toBe(false);
    expect(await visits().resolve({ token, traffic: "unknown" })).toEqual({ kind: "unavailable" });
  }
  expect(await database.prisma.communicationTrackingHit.count()).toBe(0);
  expect(isSafeTrackingTarget(`${origin}/series/example-series`, origin)).toBe(true);
});

test("provider outage retains durable backlog and live age; a new instance retries the same event", async () => {
  const first = visits();
  expect(await first.resolve({ token, traffic: "unknown" })).toEqual({ kind: "resolved", safeUrl: target });
  outage = true;
  await first.deliverPending();
  now = new Date(+now + 120_000);
  expect(await first.backlog()).toEqual({ kind: "ready", pending: 1, oldestAgeSeconds: 120 });
  outage = false;
  await visits().deliverPending();
  expect(calls).toHaveLength(2);
  expect(calls[0]).toEqual(calls[1]);
  expect(received.size).toBe(1);
  expect(await first.backlog()).toEqual({ kind: "ready", pending: 0, oldestAgeSeconds: 0 });
});

test("concurrent pumps claim once; lost ACK retries idempotently, forwarded links count independent hits", async () => {
  await visits().resolve({ token, traffic: "unknown" });
  loseAck = true;
  await Promise.all([visits().deliverPending(), visits().deliverPending()]);
  expect(calls).toHaveLength(1);
  expect(received.size).toBe(1);
  loseAck = false; now = new Date(+now + 120_000);
  await visits().deliverPending();
  expect(calls[0]).toEqual(calls[1]);
  await visits().resolve({ token, traffic: "unknown" });
  await visits().resolve({ token, traffic: "known_automation" });
  await visits().deliverPending();
  expect(received.size).toBe(3);
  expect(await database.prisma.communicationTrackingHit.count({ where: { traffic: "known_automation", deliveredAt: { not: null } } })).toBe(1);
});

test("crash after claim releases through expiry without changing event identity", async () => {
  await visits().resolve({ token, traffic: "unknown" });
  await database.prisma.communicationTrackingHit.updateMany({ data: { claimId: randomUUID(), availableAt: new Date(+now + 60_000) } });
  await visits().deliverPending(); expect(calls).toHaveLength(0);
  now = new Date(+now + 61_000); await visits().deliverPending(); expect(received.size).toBe(1);
});

test("a PostgreSQL write failure does not break resolved navigation and is observable", async () => {
  const reportFailure = vi.fn();
  await database.prisma.$transaction(async tx => {
    await tx.$executeRaw(Prisma.sql`SET TRANSACTION READ ONLY`);
    const result = await new TrackVisit(tx, provider, origin, reportFailure).resolve({ token, traffic: "unknown" });
    expect(result).toEqual({ kind: "resolved", safeUrl: target });
  });
  expect(reportFailure).toHaveBeenCalledOnce();
  expect(await database.prisma.communicationTrackingHit.count()).toBe(0);
});
