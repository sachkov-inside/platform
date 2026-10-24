import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ContentAccess, Subject } from "../../../content-access/index.js";
import {
  materialId,
  type ProductDirectory,
  type PublishedMaterialSelection,
} from "../../../materials/index.js";

export const readerReferenceSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["product", "material"]),
  availability: z.enum(["available", "locked"]),
});
export const readerReferenceIdSchema = z.uuid().toLowerCase();

/** A reader-visible business identity, without body, title, slug or a grant of access. */
export async function readReaderReference(
  dependencies: {
    readonly directory: Pick<ProductDirectory, "readerVisibleIds">;
    readonly selection: Pick<PublishedMaterialSelection, "read">;
    readonly contentAccess: Pick<
      ContentAccess,
      "checkAvailabilityMany" | "checkProductAccessMany"
    >;
  },
  subject: Subject,
  kind: "product" | "material",
  input: unknown,
) {
  const parsed = readerReferenceIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid_request" } as const;
  const id = parsed.data;
  if (kind === "product") {
    const visible = await dependencies.directory.readerVisibleIds([id], {
      subject,
      contentAccess: dependencies.contentAccess,
    });
    if (!visible.ok)
      return { ok: false, code: "dependency_unavailable" } as const;
    return visible.value.includes(id)
      ? ({ ok: true, value: { id, kind, availability: "available" } } as const)
      : ({ ok: false, code: "not_found" } as const);
  }
  const selected = await dependencies.selection.read([id]);
  if (!selected.ok)
    return { ok: false, code: "dependency_unavailable" } as const;
  if (!selected.value.some((item) => item.materialId === id))
    return { ok: false, code: "not_found" } as const;
  const checked = await dependencies.contentAccess.checkAvailabilityMany({
    subject,
    operations: [
      {
        itemId: id,
        resource: { kind: "material", materialId: materialId(id) },
        action: "read",
      },
    ],
    enforcementPoint: "published_material_read",
    correlationId: randomUUID(),
  });
  if (!checked.ok)
    return { ok: false, code: "dependency_unavailable" } as const;
  const availability = checked.items.find(
    (item) => item.itemId === id,
  )?.availability;
  return availability === "available" || availability === "locked"
    ? ({ ok: true, value: { id, kind, availability } } as const)
    : ({ ok: false, code: "not_found" } as const);
}
