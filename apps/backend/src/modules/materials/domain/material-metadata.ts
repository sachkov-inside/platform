import { z } from "zod";

import type { Result } from "../result.js";
import type { ValidationIssue } from "./material-body/material-body.js";
import { normalizedUuidSchema } from "./uuid.js";

export type MaterialAccess = "free" | "membership";

export interface SeriesMembership {
  readonly seriesId: string;
  readonly ordinal: number;
}

export interface MaterialMetadataValues {
  readonly title: string | null;
  readonly summary: string | null;
  readonly slug: string | null;
  readonly access: MaterialAccess;
  readonly topicId: string | null;
  readonly formatId: string | null;
  readonly tagIds: readonly string[];
  readonly seriesMemberships: readonly SeriesMembership[];
}

export interface PublishableMaterialMetadata
  extends Omit<
    MaterialMetadataValues,
    "formatId" | "slug" | "summary" | "title" | "topicId"
  > {
  readonly formatId: string;
  readonly slug: string;
  readonly summary: string;
  readonly title: string;
  readonly topicId: string;
}

export type MaterialMetadataValidationError =
  | {
      readonly code: "invalid_content";
      readonly issues: readonly ValidationIssue[];
    }
  | { readonly code: "duplicate_tag"; readonly tagId: string };

const metadataSchema = z
  .object({
    title: z.string().trim().min(1).max(160).nullable(),
    summary: z.string().trim().min(1).max(500).nullable(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120)
      .nullable(),
    access: z.enum(["free", "membership"]),
    topicId: normalizedUuidSchema.nullable(),
    formatId: normalizedUuidSchema.nullable(),
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

export class MaterialMetadata {
  private constructor(
    readonly title: string | null,
    readonly summary: string | null,
    readonly slug: string | null,
    readonly access: MaterialAccess,
    readonly topicId: string | null,
    readonly formatId: string | null,
    readonly tagIds: readonly string[],
    readonly seriesMemberships: readonly SeriesMembership[],
  ) {
    Object.freeze(this.tagIds);
    this.seriesMemberships.forEach(Object.freeze);
    Object.freeze(this.seriesMemberships);
    Object.freeze(this);
  }

  static create(input: unknown): Result<MaterialMetadata, MaterialMetadataValidationError> {
    const parsed = metadataSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        error: {
          code: "invalid_content",
          issues: parsed.error.issues
            .map((issue) => ({
              code: "invalid_metadata",
              path: `/metadata/${issue.path.map(String).join("/")}`,
            }))
            .sort((left, right) => left.path.localeCompare(right.path))
            .slice(0, 100),
        },
      };
    }

    const duplicateTag = findDuplicate(parsed.data.tagIds);
    if (duplicateTag !== undefined) {
      return { ok: false, error: { code: "duplicate_tag", tagId: duplicateTag } };
    }
    if (
      findDuplicate(
        parsed.data.seriesMemberships.map(({ seriesId }) => seriesId),
      ) !== undefined
    ) {
      return {
        ok: false,
        error: {
          code: "invalid_content",
          issues: [
            { code: "duplicate_series", path: "/metadata/seriesMemberships" },
          ],
        },
      };
    }

    return {
      ok: true,
      value: new MaterialMetadata(
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

  validateForPublication(): Result<
    PublishableMaterialMetadata,
    Extract<MaterialMetadataValidationError, { readonly code: "invalid_content" }>
  > {
    const issues: ValidationIssue[] = [];
    for (const [field, value] of [
      ["formatId", this.formatId],
      ["slug", this.slug],
      ["summary", this.summary],
      ["title", this.title],
      ["topicId", this.topicId],
    ] as const) {
      if (value === null) {
        issues.push({
          code: "required_for_publication",
          path: `/metadata/${field}`,
        });
      }
    }
    if (issues.length > 0) {
      return { ok: false, error: { code: "invalid_content", issues } };
    }
    return {
      ok: true,
      value: {
        access: this.access,
        formatId: requireValue(this.formatId),
        seriesMemberships: this.seriesMemberships,
        slug: requireValue(this.slug),
        summary: requireValue(this.summary),
        tagIds: this.tagIds,
        title: requireValue(this.title),
        topicId: requireValue(this.topicId),
      },
    };
  }

  toValues(): MaterialMetadataValues {
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

function findDuplicate(values: readonly string[]): string | undefined {
  const found = new Set<string>();
  return values.find((value) => {
    if (found.has(value)) {
      return true;
    }
    found.add(value);
    return false;
  });
}

function requireValue<Value>(value: Value | null): Value {
  if (value === null) {
    throw new TypeError("publishable metadata cannot contain null");
  }
  return value;
}
