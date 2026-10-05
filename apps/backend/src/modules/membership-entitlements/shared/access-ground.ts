import { z } from "zod";
import {
  accessGroundState,
  type AccessGround,
  type AccessSource,
} from "../domain/access-roster.js";
import { accessCapabilitySchema } from "../domain/access-grant.js";
import { enrollmentTermsSchema } from "../domain/subscription-enrollment.js";

/** Права без назначения, которые список людей показывает основаниями. */
export const standaloneGrantSources = ["paid", "manual", "legacy"] as const;

const snapshotSchema = z.object({
  name: z.string(),
  benefits: z.array(accessCapabilitySchema),
});

export interface EnrollmentGroundRow {
  readonly id: string;
  readonly accountId: string;
  readonly tierId: string;
  readonly snapshot: unknown;
  readonly origin: string;
  readonly startsAt: Date;
  readonly endsAt: Date | null;
  readonly endPolicy: string;
  readonly revokedAt: Date | null;
  readonly revision: number;
}
export interface GrantGroundRow {
  readonly id: string;
  readonly accountId: string;
  readonly source: string;
  readonly sourceRef: string;
  readonly capabilities: readonly string[];
  readonly startsAt: Date;
  readonly validUntil: Date | null;
  readonly revokedAt: Date | null;
  readonly revision: number;
}

/** Назначение как основание: Offer и состав берутся из снимка тарифа на момент назначения. */
export function enrollmentGround(
  row: EnrollmentGroundRow,
  now: Date,
): AccessGround {
  const snapshot = snapshotSchema.safeParse(row.snapshot);
  return {
    kind: "enrollment",
    id: row.id,
    revision: row.revision,
    source: z
      .enum(["platform_payment", "invitation", "course", "manual", "tribute"])
      .parse(row.origin),
    offer: {
      id: row.tierId,
      name: snapshot.success ? snapshot.data.name : row.tierId,
    },
    capabilities: snapshot.success ? snapshot.data.benefits : [],
    purchaseRef: null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    endPolicy: enrollmentTermsSchema.shape.endPolicy.parse(row.endPolicy),
    state: accessGroundState(row, now),
  };
}

/** Право без назначения: оплаченное — разовая покупка, ручное и прежнее — решение владельца. */
export function grantGround(row: GrantGroundRow, now: Date): AccessGround {
  const paid = row.source === "paid";
  // Оплаченное право называет свой платёж первой частью sourceRef `<purchaseRef>:<право>`.
  const purchaseRef = z.uuid().safeParse(row.sourceRef.split(":")[0]);
  const source: AccessSource = paid ? "one_time_purchase" : "manual";
  return {
    kind: "grant",
    id: row.id,
    revision: row.revision,
    source,
    offer: null,
    capabilities: z.array(accessCapabilitySchema).parse(row.capabilities),
    purchaseRef: paid && purchaseRef.success ? purchaseRef.data : null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.validUntil?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    endPolicy: null,
    state: accessGroundState(
      {
        startsAt: row.startsAt,
        endsAt: row.validUntil,
        revokedAt: row.revokedAt,
      },
      now,
    ),
  };
}
