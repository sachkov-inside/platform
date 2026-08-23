import { z } from "zod";

import type { ValidationIssue } from "./material-document/material-document.js";

export interface SeriesMembership {
  readonly seriesId: string;
  readonly ordinal: number;
}

export interface MaterialMetadataValues {
  readonly title: string;
  readonly summary: string;
  readonly slug: string;
  readonly topicId: string;
  readonly formatId: string;
  readonly tagIds: readonly string[];
  readonly seriesMemberships: readonly SeriesMembership[];
}

export type MaterialMetadataValidationError =
  | {
      readonly code: "invalid_content";
      readonly issues: readonly ValidationIssue[];
    }
  | { readonly code: "duplicate_tag"; readonly tagId: string };

export type MaterialMetadataResult =
  | { readonly ok: true; readonly value: MaterialMetadata }
  | { readonly ok: false; readonly error: MaterialMetadataValidationError };

const uuid = z.uuid().transform((value) => value.toLowerCase());
const metadataSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
    topicId: uuid,
    formatId: uuid,
    tagIds: z.array(uuid).max(100),
    seriesMemberships: z
      .array(
        z
          .object({ seriesId: uuid, ordinal: z.number().int().positive() })
          .strict(),
      )
      .max(100),
  })
  .strict();
const metadataChangesSchema = metadataSchema.partial().strict();

function invalidMetadata(error: z.ZodError): MaterialMetadataResult {
  return {
    ok: false,
    error: {
      code: "invalid_content",
      issues: error.issues
        .map((issue) => ({
          code: "invalid_metadata",
          path: `/${issue.path.map(String).join("/")}`,
        }))
        .sort((left, right) => left.path.localeCompare(right.path))
        .slice(0, 100),
    },
  };
}

export class MaterialMetadata {
  private constructor(
    readonly title: string,
    readonly summary: string,
    readonly slug: string,
    readonly topicId: string,
    readonly formatId: string,
    readonly tagIds: readonly string[],
    readonly seriesMemberships: readonly SeriesMembership[],
  ) {
    Object.freeze(this.tagIds);
    this.seriesMemberships.forEach(Object.freeze);
    Object.freeze(this.seriesMemberships);
    Object.freeze(this);
  }

  static create(input: unknown): MaterialMetadataResult {
    const parsed = metadataSchema.safeParse(input);
    if (!parsed.success) {
      return invalidMetadata(parsed.error);
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
      value: new MaterialMetadata(
        parsed.data.title,
        parsed.data.summary,
        parsed.data.slug,
        parsed.data.topicId,
        parsed.data.formatId,
        [...parsed.data.tagIds].sort(),
        [...parsed.data.seriesMemberships].sort((left, right) =>
          left.seriesId.localeCompare(right.seriesId),
        ),
      ),
    };
  }

  revise(changes: unknown): MaterialMetadataResult {
    const parsedChanges = metadataChangesSchema.safeParse(changes);
    if (!parsedChanges.success) {
      return invalidMetadata(parsedChanges.error);
    }
    return MaterialMetadata.create({
      ...this.toValues(),
      ...parsedChanges.data,
    });
  }

  toValues(): MaterialMetadataValues {
    return {
      title: this.title,
      summary: this.summary,
      slug: this.slug,
      topicId: this.topicId,
      formatId: this.formatId,
      tagIds: this.tagIds,
      seriesMemberships: this.seriesMemberships,
    };
  }
}
