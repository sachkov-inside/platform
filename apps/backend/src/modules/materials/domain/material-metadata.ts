import { z } from "zod";

import type { Result } from "../result.js";
import type { ValidationIssue } from "./material-body/material-body.js";
import { normalizedUuidSchema } from "./uuid.js";

export type MaterialAccess = "free" | "membership" | "workshop";

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

export interface MaterialMetadataSelectionValues
  extends Omit<MaterialMetadataValues, "seriesMemberships" | "slug"> {
  readonly seriesIds: readonly string[];
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

const metadataSelectionBaseShape = {
  title: z.string().trim().min(1).max(160).nullable(),
  summary: z.string().trim().min(1).max(500).nullable(),
  access: z.enum(["free", "membership", "workshop"]),
  topicId: normalizedUuidSchema.nullable(),
  formatId: normalizedUuidSchema.nullable(),
  tagIds: z.array(normalizedUuidSchema).max(100),
} as const;

const metadataSchema = z
  .object({
    ...metadataSelectionBaseShape,
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120)
      .nullable(),
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

const metadataSelectionSchema = z
  .object({
    ...metadataSelectionBaseShape,
    seriesIds: z.array(normalizedUuidSchema).max(100),
  })
  .strict();

export class MaterialMetadataSelection {
  private constructor(
    private readonly values: MaterialMetadataSelectionValues,
  ) {
    Object.freeze(this.values.tagIds);
    Object.freeze(this.values.seriesIds);
    Object.freeze(this.values);
    Object.freeze(this);
  }

  static create(
    input: unknown,
  ): Result<MaterialMetadataSelection, MaterialMetadataValidationError> {
    const parsed = metadataSelectionSchema.safeParse(input);
    if (!parsed.success) {
      return invalidMetadata(parsed.error.issues);
    }
    const duplicateTag = findDuplicate(parsed.data.tagIds);
    if (duplicateTag !== undefined) {
      return { ok: false, error: { code: "duplicate_tag", tagId: duplicateTag } };
    }
    if (findDuplicate(parsed.data.seriesIds) !== undefined) {
      return {
        ok: false,
        error: {
          code: "invalid_content",
          issues: [{ code: "duplicate_series", path: "/metadata/seriesIds" }],
        },
      };
    }
    return {
      ok: true,
      value: new MaterialMetadataSelection({
        ...parsed.data,
        tagIds: [...parsed.data.tagIds].sort(),
        seriesIds: [...parsed.data.seriesIds].sort(),
      }),
    };
  }

  materialize(
    seriesMemberships: readonly SeriesMembership[],
    slug: string | null,
  ): MaterialMetadata {
    const metadata = MaterialMetadata.create({
      title: this.values.title,
      summary: this.values.summary,
      slug,
      access: this.values.access,
      topicId: this.values.topicId,
      formatId: this.values.formatId,
      tagIds: this.values.tagIds,
      seriesMemberships,
    });
    if (!metadata.ok) {
      throw new TypeError("Validated metadata selection could not be materialized");
    }
    return metadata.value;
  }

  toValues(): MaterialMetadataSelectionValues {
    return this.values;
  }
}

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
      return invalidMetadata(parsed.error.issues);
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

  validateAuthoringCompleteness(): Result<
    undefined,
    Extract<MaterialMetadataValidationError, { readonly code: "invalid_content" }>
  > {
    const issues = requiredPublicationIssues(this, false);
    return issues.length === 0
      ? { ok: true, value: undefined }
      : { ok: false, error: { code: "invalid_content", issues } };
  }

  validateForPublication(): Result<
    PublishableMaterialMetadata,
    Extract<MaterialMetadataValidationError, { readonly code: "invalid_content" }>
  > {
    const issues = requiredPublicationIssues(this, true);
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

function requiredPublicationIssues(
  metadata: MaterialMetadata,
  includeSystemSlug: boolean,
): ValidationIssue[] {
  const fields: readonly (readonly [string, unknown])[] = [
    ["formatId", metadata.formatId],
    ...(includeSystemSlug ? ([["slug", metadata.slug]] as const) : []),
    ["summary", metadata.summary],
    ["title", metadata.title],
    ["topicId", metadata.topicId],
  ];
  return fields.flatMap(([field, value]) =>
    value === null
      ? [{ code: "required_for_publication", path: `/metadata/${field}` }]
      : [],
  );
}

function invalidMetadata(
  issues: readonly z.core.$ZodIssue[],
): Result<never, MaterialMetadataValidationError> {
  return {
    ok: false,
    error: {
      code: "invalid_content",
      issues: issues
        .map((issue) => ({
          code: "invalid_metadata",
          path: `/metadata/${issue.path.map(String).join("/")}`,
        }))
        .sort((left, right) => left.path.localeCompare(right.path))
        .slice(0, 100),
    },
  };
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
