import { z } from "zod";

import type {
  ContentAuthoringError,
  DraftMetadata,
} from "../content-authoring.interface.js";

const uuid = z.uuid();
const metadataSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(500),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  topicId: uuid,
  formatId: uuid,
  tagIds: z.array(uuid).max(100),
  seriesMemberships: z
    .array(z.object({ seriesId: uuid, ordinal: z.number().int().positive() }))
    .max(100),
});

export type MetadataValidation =
  | { readonly ok: true; readonly value: DraftMetadata }
  | { readonly ok: false; readonly error: ContentAuthoringError };

export function validateMetadata(input: unknown): MetadataValidation {
  const parsed = metadataSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "invalid_content",
        issues: parsed.error.issues
          .map((issue) => ({
            code: "invalid_metadata",
            path: `/${issue.path.map(String).join("/")}`,
          }))
          .sort((left, right) => left.path.localeCompare(right.path))
          .slice(0, 100),
      },
    };
  }

  const tags = new Set<string>();
  for (const tagId of parsed.data.tagIds) {
    if (tags.has(tagId)) {
      return { ok: false, error: { code: "duplicate_tag", tagId } };
    }
    tags.add(tagId);
  }

  const series = new Set<string>();
  for (const membership of parsed.data.seriesMemberships) {
    if (series.has(membership.seriesId)) {
      return {
        ok: false,
        error: {
          code: "invalid_content",
          issues: [{ code: "duplicate_series", path: "/seriesMemberships" }],
        },
      };
    }
    series.add(membership.seriesId);
  }

  return {
    ok: true,
    value: {
      ...parsed.data,
      tagIds: [...parsed.data.tagIds].sort(),
      seriesMemberships: [...parsed.data.seriesMemberships].sort((left, right) =>
        left.seriesId.localeCompare(right.seriesId),
      ),
    },
  };
}
