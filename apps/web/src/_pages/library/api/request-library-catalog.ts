import { z } from "zod";

import type { LibraryCatalogPage } from "../model/library-view";

const materialPreviewSchema = z
  .object({
    access: z.enum(["free", "membership"]),
    format: z.string(),
    seriesMemberships: z.array(
      z.object({ name: z.string(), ordinal: z.number().int().positive() }).strict(),
    ),
    slug: z.string(),
    summary: z.string(),
    tags: z.array(z.string()),
    title: z.string(),
    topic: z.string(),
  })
  .strict();

const libraryCatalogPageSchema: z.ZodType<LibraryCatalogPage> =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("ready"),
        items: z.array(materialPreviewSchema),
        nextCursor: z.string().min(1).max(512).nullable(),
      })
      .strict(),
    z.object({ kind: z.literal("empty") }).strict(),
    z.object({ kind: z.literal("unavailable") }).strict(),
  ]);

export class LibraryCatalogQueryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LibraryCatalogQueryError";
  }
}

export async function requestLibraryCatalogPage(
  after: string | undefined,
  signal: AbortSignal,
): Promise<LibraryCatalogPage> {
  const response = await fetch(
    after === undefined
      ? "/api/library/materials"
      : `/api/library/materials?after=${encodeURIComponent(after)}`,
    {
      headers: { Accept: "application/json" },
      signal,
    },
  );

  if (!response.ok) {
    throw new LibraryCatalogQueryError(
      `Library query returned ${String(response.status)}`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new LibraryCatalogQueryError(
      "Library query response is not valid JSON",
      { cause },
    );
  }

  const parsed = libraryCatalogPageSchema.safeParse(payload);
  if (!parsed.success) {
    throw new LibraryCatalogQueryError(
      "Library query response does not match the presentation contract",
      { cause: parsed.error },
    );
  }

  return parsed.data;
}
