import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { HttpCommunicationsProvider } from "../../infrastructure/http-communications-provider.js";
import type { CommunicationsPrisma } from "../../infrastructure/prisma.js";

export const trackingInputSchema = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
  traffic: z.enum(["unknown", "known_automation"]),
});
export const trackingResultSchema = z.union([
  z.strictObject({ kind: z.literal("resolved"), safeUrl: z.url() }),
  z.strictObject({ kind: z.enum(["invalid", "not_found", "unavailable"]) }),
]);
export const trackingBacklogSchema = z.union([
  z.strictObject({
    kind: z.literal("ready"),
    pending: z.number().int().nonnegative(),
    oldestAgeSeconds: z.number().int().nonnegative(),
  }),
  z.strictObject({ kind: z.literal("unavailable") }),
]);
const NAVIGATION_PERSISTENCE_BUDGET_MS = 750;
const HIT_RETRY_DELAY_MS = 30_000;
const HIT_CLAIM_DURATION_MS = 60_000;
const HIT_BATCH_SIZE = 25;
const envelope = {
  contractVersion: "inside-communications-v1",
  actor: { serviceRef: "platform-tracking" },
  expectedRevision: 0,
} as const;

// Resolve only configured public content routes; visiting them still runs ContentAccess.
export function isSafeTrackingTarget(
  value: string,
  origin: string | undefined,
): boolean {
  if (!origin) return false;
  const parsed = z.url().safeParse(value);
  if (!parsed.success) return false;
  const url = new URL(parsed.data);
  return (
    url.protocol === "https:" &&
    url.origin === new URL(origin).origin &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    /^\/(?:materials|series)\/[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(url.pathname)
  );
}

export class TrackingVisits {
  constructor(
    private readonly prisma: CommunicationsPrisma,
    private readonly provider: HttpCommunicationsProvider,
    private readonly origin: string | undefined,
    private readonly reportFailure: () => void = () => {
      /* Optional observer for isolated application tests. */
    },
    private readonly now: () => Date = () => new Date(),
  ) {}

  async resolve(input: unknown): Promise<z.infer<typeof trackingResultSchema>> {
    const parsed = trackingInputSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid" };
    if (!this.origin) return { kind: "unavailable" };
    const result = await this.provider.execute({
      ...envelope,
      operation: "tracking.resolve",
      operationId: randomUUID(),
      payload: { token: parsed.data.token },
    });
    if (!result.ok)
      return {
        kind: result.error.code === "not_found" ? "not_found" : "unavailable",
      };
    if (
      !("safeUrl" in result.value) ||
      !isSafeTrackingTarget(result.value.safeUrl, this.origin)
    )
      return { kind: "unavailable" };
    const now = this.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.prisma.communicationTrackingHit.create({
          data: {
            eventId: randomUUID(),
            token: parsed.data.token,
            traffic: parsed.data.traffic,
            occurredAt: now,
            availableAt: now,
          },
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error("Tracking persistence confirmation timed out"));
          }, NAVIGATION_PERSISTENCE_BUDGET_MS);
        }),
      ]);
    } catch {
      // Navigation survives a failed local insert. Only persisted events can be retried;
      // report this explicit loss without logging the token or visitor information.
      this.reportFailure();
    } finally {
      clearTimeout(timer);
    }
    return { kind: "resolved", safeUrl: result.value.safeUrl };
  }

  async backlog(): Promise<z.infer<typeof trackingBacklogSchema>> {
    try {
      const [pending, oldest] = await Promise.all([
        this.prisma.communicationTrackingHit.count({
          where: { deliveredAt: null },
        }),
        this.prisma.communicationTrackingHit.findFirst({
          where: { deliveredAt: null },
          orderBy: { occurredAt: "asc" },
          select: { occurredAt: true },
        }),
      ]);
      return {
        kind: "ready",
        pending,
        oldestAgeSeconds: oldest
          ? Math.max(0, Math.ceil((+this.now() - +oldest.occurredAt) / 1000))
          : 0,
      };
    } catch {
      return { kind: "unavailable" };
    }
  }

  async deliverPending(): Promise<void> {
    const rows = await this.prisma.communicationTrackingHit.findMany({
      where: { deliveredAt: null, availableAt: { lte: this.now() } },
      orderBy: { occurredAt: "asc" },
      take: HIT_BATCH_SIZE,
    });
    await Promise.all(
      rows.map(async (row) => {
        const claimId = randomUUID();
        const claim = await this.prisma.communicationTrackingHit.updateMany({
          where: {
            eventId: row.eventId,
            deliveredAt: null,
            availableAt: { lte: this.now() },
          },
          data: {
            claimId,
            availableAt: new Date(+this.now() + HIT_CLAIM_DURATION_MS),
          },
        });
        if (!claim.count) return;
        // Event and operation IDs survive retries, process restarts and ambiguous ACKs.
        const result = await this.provider.execute({
          ...envelope,
          operation: "tracking.recordHit",
          operationId: row.eventId,
          payload: {
            eventId: row.eventId,
            token: row.token,
            occurredAt: row.occurredAt.toISOString(),
            traffic:
              row.traffic === "known_automation"
                ? "known_automation"
                : "unknown",
          },
        });
        await this.prisma.communicationTrackingHit.updateMany({
          where: { eventId: row.eventId, claimId, deliveredAt: null },
          data: result.ok
            ? { deliveredAt: this.now(), claimId: null }
            : {
                availableAt: new Date(+this.now() + HIT_RETRY_DELAY_MS),
                claimId: null,
              },
        });
      }),
    );
  }
}
