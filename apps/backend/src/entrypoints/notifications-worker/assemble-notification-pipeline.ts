import type {
  BillingPrisma,
  MaterialsPrisma,
} from "../../infrastructure/prisma/index.js";
import { assembleNotificationWorker } from "../../infrastructure/notification-transport/worker.js";
import { assembleBillingNotificationOutbox } from "../../modules/billing/index.js";
import { assembleMaterialsNotificationOutbox } from "../../modules/materials/index.js";

export function assembleNotificationPipeline({
  prisma,
  ...worker
}: Omit<
  Parameters<typeof assembleNotificationWorker>[0],
  "billing" | "materials"
> & { prisma: BillingPrisma & MaterialsPrisma }) {
  return assembleNotificationWorker({
    ...worker,
    billing: assembleBillingNotificationOutbox(prisma),
    materials: assembleMaterialsNotificationOutbox(prisma),
  });
}
