import { z } from "zod";
import type { MaterialsPrismaClient } from "../../../../infrastructure/prisma/index.js";
import { selectPublishedMaterialProjectionsByIds } from "../../infrastructure/postgres/published-material-reader/published-material-projection.js";
import type { PublishedMaterialProjectionDto } from "../../facets/published-material-reader/published-material.contract.js";
export class PublishedMaterialSelection {
  constructor(private readonly prisma: MaterialsPrismaClient) {}
  async read(materialIds: readonly string[]): Promise<
    | { readonly ok: true; readonly value: readonly PublishedMaterialProjectionDto[] }
    | { readonly ok: false; readonly error: { readonly code: "invalid_request" | "dependency_unavailable" } }
  > {
    const parsed = z.array(z.uuid()).max(100).safeParse(materialIds);
    if (!parsed.success) return { ok: false, error: { code: "invalid_request" } };
    try { return { ok: true, value: await selectPublishedMaterialProjectionsByIds(this.prisma, parsed.data) }; }
    catch { return { ok: false, error: { code: "dependency_unavailable" } }; }
  }
}
