import { z } from "zod";

import type { WorkshopPrisma } from "../../infrastructure/prisma.js";
import type { WorkshopAccessState } from "../../facets/workshop/workshop.interface.js";
import { workshopScopeSchema } from "../../shared/workshop-validation.js";

const inputSchema = z
  .object({
    accountId: z.uuid(),
    workshopScope: workshopScopeSchema,
  })
  .strict();

export async function resolveWorkshopAccess(
  prisma: WorkshopPrisma,
  input: { readonly accountId: string; readonly workshopScope: string },
  now: Date,
): Promise<WorkshopAccessState> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { kind: "unavailable" };

  try {
    const active = await prisma.workshopEntitlement.findFirst({
      where: {
        accountId: parsed.data.accountId,
        workshopScope: parsed.data.workshopScope,
        startsAt: { lte: now },
        validUntil: { gt: now },
      },
      orderBy: [{ validUntil: "desc" }, { createdAt: "desc" }],
    });
    if (active !== null) {
      return {
        kind: "active",
        startsAt: active.startsAt.toISOString(),
        validUntil: active.validUntil.toISOString(),
      };
    }

    const future = await prisma.workshopEntitlement.findFirst({
      where: {
        accountId: parsed.data.accountId,
        workshopScope: parsed.data.workshopScope,
        startsAt: { gt: now },
      },
      select: { id: true },
    });
    if (future !== null) return { kind: "not_started" };

    const expired = await prisma.workshopEntitlement.findFirst({
      where: {
        accountId: parsed.data.accountId,
        workshopScope: parsed.data.workshopScope,
        validUntil: { lte: now },
      },
      select: { id: true },
    });
    return expired === null ? { kind: "required" } : { kind: "expired" };
  } catch {
    return { kind: "unavailable" };
  }
}
