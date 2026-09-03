import type {
  PlatformPrisma,
  TransactionClient,
} from "../../../infrastructure/prisma/prisma-client.js";

export type WorkshopPrisma = Pick<
  PlatformPrisma,
  | "$executeRaw"
  | "workshopCase"
  | "workshopCaseMaterial"
  | "workshopCaseVersion"
  | "workshopEntitlement"
  | "workshopHintReveal"
  | "workshopSolutionReveal"
>;
export type WorkshopPrismaTransaction = WorkshopPrisma;
export type WorkshopPrismaClient = WorkshopPrisma &
  TransactionClient<WorkshopPrismaTransaction>;
