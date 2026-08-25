import { z } from "zod";

import type { PublishedMaterialReader } from "../materials/index.js";
import type { ContentLibrary } from "./content-library.interface.js";

const listPublishedMaterialsQuerySchema = z
  .object({
    after: z.string().min(1).max(512).optional(),
    first: z.number().int().min(1).max(24),
  })
  .strict();

const cursorSchema = z
  .object({
    v: z.literal(1),
    materialId: z.uuid(),
    publishedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export function createContentLibrary(dependencies: {
  readonly publishedMaterialReader: Pick<PublishedMaterialReader, "listProjections">;
}): ContentLibrary {
  return {
    async listPublishedMaterials(query) {
      const parsed = listPublishedMaterialsQuerySchema.safeParse(query);
      if (!parsed.success) {
        return { ok: false, error: { code: "invalid_request_shape" } };
      }
      const after =
        parsed.data.after === undefined
          ? undefined
          : decodeCursor(parsed.data.after);
      if (parsed.data.after !== undefined && after === undefined) {
        return { ok: false, error: { code: "invalid_request_shape" } };
      }
      const page = await dependencies.publishedMaterialReader.listProjections({
        first: parsed.data.first,
        ...(after === undefined ? {} : { after }),
      });
      if (!page.ok) {
        return page;
      }
      const lastItem = page.value.items.at(-1);
      return {
        ok: true,
        value: {
          items: page.value.items,
          nextCursor:
            page.value.hasNext && lastItem !== undefined
              ? encodeCursor({
                  materialId: lastItem.materialId,
                  publishedAt: lastItem.publishedAt,
                })
              : null,
        },
      };
    },
  };
}

interface PublishedMaterialCursor {
  readonly materialId: string;
  readonly publishedAt: string;
}

function decodeCursor(value: string): PublishedMaterialCursor | undefined {
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success
      ? {
          materialId: parsed.data.materialId,
          publishedAt: parsed.data.publishedAt,
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function encodeCursor(value: PublishedMaterialCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      materialId: value.materialId,
      publishedAt: value.publishedAt,
    }),
    "utf8",
  ).toString("base64url");
}
