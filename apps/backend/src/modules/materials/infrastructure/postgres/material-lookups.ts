import type { MaterialsPrisma } from "../../../../infrastructure/prisma/index.js";
import {
  materialRevisionId,
  type MaterialId,
  type MaterialRevisionId,
} from "../../domain/material-identifiers.js";

export interface MaterialRevisionHeader {
  readonly materialId: MaterialId;
  readonly revisionId: MaterialRevisionId;
  readonly access: "free" | "membership";
}

export async function loadCurrentRevisionId(
  prisma: MaterialsPrisma,
  materialIdValue: MaterialId,
): Promise<MaterialRevisionId | undefined> {
  const material = await prisma.material.findUnique({
    where: { id: materialIdValue },
    select: { currentDraftRevisionId: true },
  });
  return material === null
    ? undefined
    : materialRevisionId(material.currentDraftRevisionId);
}

export async function loadMaterialRevisionHeader(
  prisma: MaterialsPrisma,
  materialIdValue: MaterialId,
  revisionIdValue: MaterialRevisionId,
): Promise<MaterialRevisionHeader | undefined> {
  const row = await prisma.materialRevision.findFirst({
    where: { materialId: materialIdValue, id: revisionIdValue },
    select: { materialId: true, id: true, access: true },
  });
  return row === null || (row.access !== "free" && row.access !== "membership")
    ? undefined
    : {
        materialId: materialIdValue,
        revisionId: materialRevisionId(row.id),
        access: row.access,
      };
}
