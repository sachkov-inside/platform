import { z } from "zod";
import {
  lockProductIntake,
  transactionHandle,
  type SalesFunnelPrismaClient,
} from "../../../../infrastructure/prisma/index.js";
import { dependencyFailure } from "../../../../infrastructure/observability/index.js";
import type { ProductDiscovery } from "../../../products/index.js";
import type {
  CreateProductIntakeCommand,
  CreateProductIntakeOperation,
  ProductIntakeReceipt,
} from "./create-product-intake.contract.js";

const commandSchema: z.ZodType<CreateProductIntakeCommand> = z.strictObject({
  intakeId: z.uuid().toLowerCase(),
  productId: z.uuid().toLowerCase(),
  name: z.string().trim().min(1).max(120),
  accepting: z.boolean(),
});

/** A trusted process creates an explicit intake; it neither joins an Account nor opens sales. */
export function assembleCreateProductIntake(dependencies: {
  readonly prisma: SalesFunnelPrismaClient;
  readonly products: Pick<ProductDiscovery, "metadata">;
}): CreateProductIntakeOperation {
  return async (input) => {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success)
      return { ok: false, error: { code: "invalid_request" } };
    const command = parsed.data;
    try {
      return await dependencies.prisma.$transaction(async (transaction) => {
        await lockProductIntake(transaction, command.intakeId);
        const products = await dependencies.products.metadata(
          { ids: [command.productId] },
          transactionHandle(transaction),
        );
        if (products.length !== 1 || products[0]?.archivedAt !== null)
          return { ok: false, error: { code: "product_not_found" } };
        const existing = await transaction.productWaitlistIntake.findUnique({
          where: { id: command.intakeId },
        });
        if (
          existing !== null &&
          (existing.productId !== command.productId ||
            existing.name !== command.name ||
            existing.accepting !== command.accepting)
        )
          return { ok: false, error: { code: "intake_conflict" } };
        if (existing === null && command.accepting) {
          const current = await transaction.productWaitlistIntake.findFirst({
            where: { productId: command.productId, accepting: true },
            select: { id: true },
          });
          if (current !== null)
            return { ok: false, error: { code: "accepting_intake_exists" } };
        }
        const row =
          existing ??
          (await transaction.productWaitlistIntake.create({
            data: {
              id: command.intakeId,
              productId: command.productId,
              name: command.name,
              accepting: command.accepting,
            },
          }));
        const value: ProductIntakeReceipt = {
          intakeId: row.id,
          productId: row.productId,
          name: row.name,
          accepting: row.accepting,
        };
        return { ok: true, value };
      });
    } catch (error) {
      return dependencyFailure(
        { module: "sales-funnel", operation: "createProductIntake" },
        error,
        { ok: false, error: { code: "dependency_unavailable" } },
      );
    }
  };
}
