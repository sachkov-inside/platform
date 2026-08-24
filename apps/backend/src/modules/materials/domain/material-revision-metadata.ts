import { z } from "zod";

import type { Result } from "../result.js";
import type { ValidationIssue } from "./material-body/material-body.js";
import { normalizedUuidSchema } from "./uuid.js";

export interface SeriesMembership {
  readonly seriesId: string;
  readonly ordinal: number;
}

export type MaterialAccess = "free" | "membership";

export interface MaterialRevisionMetadataValues {
  readonly title: string;
  readonly summary: string;
  readonly slug: string;
  readonly access: MaterialAccess;
  readonly topicId: string;
  readonly formatId: string;
  readonly tagIds: readonly string[];
  readonly seriesMemberships: readonly SeriesMembership[];
}

export type MaterialRevisionMetadataChangeValues = Partial<MaterialRevisionMetadataValues>;

export type MaterialMetadataValidationError =
  | {
      readonly code: "invalid_content";
      readonly issues: readonly ValidationIssue[];
    }
  | { readonly code: "duplicate_tag"; readonly tagId: string };

export type MaterialRevisionMetadataResult = Result<
  MaterialRevisionMetadata,
  MaterialMetadataValidationError
>;

export type MaterialRevisionMetadataChangesResult = Result<
  MaterialRevisionMetadataChangeValues,
  MaterialMetadataValidationError
>;

const metadataSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(500),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
    access: z.enum(["free", "membership"]),
    topicId: normalizedUuidSchema,
    formatId: normalizedUuidSchema,
    tagIds: z.array(normalizedUuidSchema).max(100),
    seriesMemberships: z
      .array(
        z
          .object({
            seriesId: normalizedUuidSchema,
            ordinal: z.number().int().positive(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
const metadataChangesSchema = metadataSchema.partial().strict();

function invalidMetadata(error: z.ZodError): {
  readonly ok: false;
  readonly error: MaterialMetadataValidationError;
} {
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

export class MaterialRevisionMetadata {
  private constructor(
    readonly title: string,
    readonly summary: string,
    readonly slug: string,
    readonly access: MaterialAccess,
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

  static create(input: unknown): MaterialRevisionMetadataResult {
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
      value: new MaterialRevisionMetadata(
        parsed.data.title,
        parsed.data.summary,
        parsed.data.slug,
        parsed.data.access,
        parsed.data.topicId,
        parsed.data.formatId,
        [...parsed.data.tagIds].sort(),
        [...parsed.data.seriesMemberships].sort((left, right) =>
          left.seriesId.localeCompare(right.seriesId),
        ),
      ),
    };
  }

  static validateChanges(input: unknown): MaterialRevisionMetadataChangesResult {
    const parsed = metadataChangesSchema.safeParse(input);
    if (!parsed.success) {
      return invalidMetadata(parsed.error);
    }
    return {
      ok: true,
      value: Object.fromEntries(
        Object.entries(parsed.data).filter(([, value]) => value !== undefined),
      ),
    };
  }

  revise(changes: unknown): MaterialRevisionMetadataResult {
    const parsedChanges = MaterialRevisionMetadata.validateChanges(changes);
    if (!parsedChanges.ok) {
      return parsedChanges;
    }
    return MaterialRevisionMetadata.create({
      ...this.toValues(),
      ...parsedChanges.value,
    });
  }

  toValues(): MaterialRevisionMetadataValues {
    return {
      title: this.title,
      summary: this.summary,
      slug: this.slug,
      access: this.access,
      topicId: this.topicId,
      formatId: this.formatId,
      tagIds: this.tagIds,
      seriesMemberships: this.seriesMemberships,
    };
  }
}
