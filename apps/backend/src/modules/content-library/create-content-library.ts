import { z } from "zod";

import type { PlatformDatabase } from "../../infrastructure/postgres/index.js";
import type { ContentLibrary } from "./content-library.interface.js";
import { mapContentLibraryPersistenceError } from "./map-content-library-persistence-error.js";
import {
  findPublishedMaterialProjection,
  listPublishedMaterialProjections,
  type PublishedMaterialCursor,
  type MaterialId,
} from "./infrastructure/postgres/published-material-projection.js";

const listPublishedMaterialsQuerySchema = z
  .object({
    after: z.string().min(1).max(512).optional(),
    first: z.number().int().min(1).max(24),
  })
  .strict();

const publishedMaterialSlugSchema = z
  .string()
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

const cursorSchema = z
  .object({
    v: z.literal(1),
    materialId: z.uuid(),
    publishedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export function createContentLibrary(dependencies: {
  readonly database: PlatformDatabase;
}): ContentLibrary {
  return {
    async findPublishedMaterial(slug) {
      const parsed = publishedMaterialSlugSchema.safeParse(slug);
      if (!parsed.success) {
        return { ok: false, error: { code: "invalid_request_shape" } };
      }
      try {
        return {
          ok: true,
          value: await findPublishedMaterialProjection(
            dependencies.database,
            parsed.data,
          ),
        };
      } catch (error) {
        return { ok: false, error: mapContentLibraryPersistenceError(error) };
      }
    },
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
      try {
        const page = await listPublishedMaterialProjections(dependencies.database, {
          first: parsed.data.first,
          ...(after === undefined ? {} : { after }),
        });
        const lastItem = page.items.at(-1);
        return {
          ok: true,
          value: {
            items: page.items,
            nextCursor:
              page.hasNext && lastItem !== undefined
                ? encodeCursor({
                    materialId: materialId(lastItem.materialId),
                    publishedAt: new Date(lastItem.publishedAt),
                  })
                : null,
          },
        };
      } catch (error) {
        return { ok: false, error: mapContentLibraryPersistenceError(error) };
      }
    },
  };
}

function decodeCursor(value: string): PublishedMaterialCursor | undefined {
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success
      ? {
          materialId: materialId(parsed.data.materialId),
          publishedAt: new Date(parsed.data.publishedAt),
        }
      : undefined;
  } catch {
    return undefined;
  }
}

function materialId(value: string): MaterialId {
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) {
    throw new TypeError("MaterialId must be a UUID");
  }
  // This checked constructor is the only assertion for the local nominal ID.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return parsed.data as MaterialId;
}

function encodeCursor(value: PublishedMaterialCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      materialId: value.materialId,
      publishedAt: value.publishedAt.toISOString(),
    }),
    "utf8",
  ).toString("base64url");
}
