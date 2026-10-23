import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import {
  unwrapTransaction,
  type TransactionHandle,
} from "../../../../infrastructure/prisma/transaction-handle.js";
import type {
  ContentCoverSelection,
  ContentCoverOwner,
} from "../../../content-covers/index.js";
import { lockMaterialForLifecycleChange } from "./material-locks.js";
import { materialId } from "../../domain/material-identifiers.js";

/** Materials selects only Material and Topic pointers; cover lifecycle belongs to Content Covers. */
export class MaterialCoverSelection implements ContentCoverSelection {
  async read(owner: ContentCoverOwner, handle: TransactionHandle) {
    const prisma = persistence(handle);
    if (owner.kind === "material") {
      const material = await lockMaterialForLifecycleChange(
        prisma,
        materialId(owner.id),
      );
      if (material === undefined) return undefined;
      const row = await prisma.material.findUnique({
        where: { id: owner.id },
        select: { coverId: true, sourceId: true },
      });
      return row ?? undefined;
    }
    if (owner.kind === "topic") {
      const row = await prisma.topic.findUnique({
        where: { id: owner.id },
        select: { coverId: true },
      });
      return row === null ? undefined : { ...row, sourceId: null };
    }
    return undefined;
  }
  async write(
    owner: ContentCoverOwner,
    coverId: string | null,
    handle: TransactionHandle,
  ) {
    const prisma = persistence(handle);
    if (owner.kind === "material") {
      await prisma.material.update({
        where: { id: owner.id },
        data: { coverId, updatedAt: new Date() },
      });
      await prisma.publishedMaterial.updateMany({
        where: { materialId: owner.id },
        data: { coverId },
      });
    } else if (owner.kind === "topic") {
      await prisma.topic.update({
        where: { id: owner.id },
        data: { coverId, updatedAt: new Date() },
      });
    } else throw new TypeError("Unsupported Material cover owner");
  }
  async references(
    owner: ContentCoverOwner,
    coverId: string,
    handle: TransactionHandle,
  ) {
    const prisma = persistence(handle);
    if (owner.kind === "material") {
      const current = await prisma.material.count({ where: { coverId } });
      const published = await prisma.publishedMaterial.count({
        where: { coverId },
      });
      return current > 0 || published > 0;
    }
    return (
      owner.kind === "topic" &&
      (await prisma.topic.count({ where: { coverId } })) > 0
    );
  }
}
function persistence(handle: TransactionHandle): MaterialsPrisma {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The owning persistence adapter narrows the validated connection to its own delegates.
  return unwrapTransaction(handle) as MaterialsPrisma;
}
