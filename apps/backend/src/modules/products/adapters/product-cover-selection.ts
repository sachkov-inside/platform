import { Prisma } from "../../../infrastructure/prisma/index.js";
import type { TransactionHandle } from "../../../infrastructure/prisma/transaction-handle.js";
import { productsTransaction } from "../infrastructure/transaction.js";

/** Selects the Product cover. Uploads, recovery and object cleanup belong to Content Covers. */
export class ProductCoverSelection {
  async read(
    owner: { readonly kind: string; readonly id: string },
    handle: TransactionHandle,
  ) {
    if (owner.kind !== "series") return undefined;
    const prisma = productsTransaction(handle);
    await prisma.$queryRaw(
      Prisma.sql`select id from products.products where id = ${owner.id}::uuid for update`,
    );
    return (
      (await prisma.product.findUnique({
        where: { id: owner.id },
        select: { coverId: true, sourceId: true },
      })) ?? undefined
    );
  }
  async write(
    owner: { readonly kind: string; readonly id: string },
    coverId: string | null,
    handle: TransactionHandle,
  ): Promise<void> {
    if (owner.kind !== "series")
      throw new TypeError("Product cover selection requires a Product owner");
    await productsTransaction(handle).product.update({
      where: { id: owner.id },
      data: { coverId, updatedAt: new Date() },
    });
  }
  async references(
    owner: { readonly kind: string; readonly id: string },
    coverId: string,
    handle: TransactionHandle,
  ): Promise<boolean> {
    if (owner.kind !== "series") return false;
    return (
      (await productsTransaction(handle).product.findFirst({
        where: { id: owner.id, coverId },
        select: { id: true },
      })) !== null
    );
  }
}
