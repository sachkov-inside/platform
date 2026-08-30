import "server-only";

import { z } from "zod";

import type {
  MaterialPreviewBlock,
  MaterialPreviewMark,
  MaterialPreviewPresentation,
  MaterialPreviewText,
} from "@/features/material-authoring";

import type { MaterialAuthoringReferences } from "./get-material-authoring-references";

const markSchema: z.ZodType<MaterialPreviewMark> = z.union([
  z.object({ kind: z.enum(["bold", "code", "italic", "strike"]) }).strict(),
  z.object({ href: z.string(), kind: z.literal("link") }).strict(),
]);

const textSchema: z.ZodType<MaterialPreviewText> = z
  .object({
    kind: z.literal("text"),
    marks: z.array(markSchema),
    text: z.string(),
  })
  .strict();

const blockSchema: z.ZodType<MaterialPreviewBlock> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ content: z.array(textSchema), kind: z.literal("paragraph") }).strict(),
    z
      .object({
        content: z.array(textSchema),
        kind: z.literal("heading"),
        level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      })
      .strict(),
    z.object({ items: z.array(z.array(blockSchema)), kind: z.literal("bullet_list") }).strict(),
    z.object({ items: z.array(z.array(blockSchema)), kind: z.literal("ordered_list") }).strict(),
    z.object({ content: z.array(blockSchema), kind: z.literal("blockquote") }).strict(),
    z.object({ kind: z.literal("code_block"), text: z.string() }).strict(),
    z.object({ kind: z.literal("horizontal_rule") }).strict(),
    z
      .object({
        kind: z.literal("table"),
        rows: z.array(
          z
            .object({
              cells: z.array(
                z
                  .object({
                    content: z.array(blockSchema),
                    header: z.boolean(),
                  })
                  .strict(),
              ),
            })
            .strict(),
        ),
      })
      .strict(),
    z
      .object({
        content: z.array(blockSchema),
        kind: z.literal("callout"),
        tone: z.enum(["note", "tip", "warning"]),
      })
      .strict(),
    z
      .object({
        alt: z.string(),
        assetId: z.uuid(),
        caption: z.string().optional(),
        kind: z.literal("image"),
      })
      .strict(),
    z
      .object({ assetId: z.uuid(), kind: z.literal("file"), label: z.string() })
      .strict(),
    z
      .object({
        caption: z.string().optional(),
        kind: z.literal("video"),
        videoId: z.uuid(),
      })
      .strict(),
  ]),
);

const seriesMembershipSchema = z
  .object({ ordinal: z.number().int().positive(), seriesId: z.uuid() })
  .strict();

const previewSchema = z
  .object({
    body: z.object({ blocks: z.array(blockSchema), schemaVersion: z.literal(1) }).strict(),
    cacheScope: z.literal("private-no-store"),
    contentVersion: z.number().int().positive(),
    materialId: z.uuid(),
    metadata: z
      .object({
        access: z.enum(["free", "membership"]),
        formatId: z.uuid().nullable(),
        seriesMemberships: z.array(seriesMembershipSchema),
        slug: z.string().nullable(),
        summary: z.string().nullable(),
        tagIds: z.array(z.uuid()),
        title: z.string().nullable(),
        topicId: z.uuid().nullable(),
      })
      .strict(),
    publicationState: z.enum(["draft", "published", "unpublished"]),
  })
  .strict();

export interface MappedCurrentMaterialPreview {
  readonly access: "free" | "membership";
  readonly contentVersion: number;
  readonly formatId: string | null;
  readonly materialId: string;
  readonly publicationState: "draft" | "published" | "unpublished";
  readonly seriesMemberships: readonly {
    readonly ordinal: number;
    readonly seriesId: string;
  }[];
  readonly preview: MaterialPreviewPresentation;
  readonly slug: string | null;
  readonly summary: string | null;
  readonly tagIds: readonly string[];
  readonly title: string | null;
  readonly topicId: string | null;
}

export function mapCurrentMaterialPreview(
  value: unknown,
  references?: MaterialAuthoringReferences,
):
  | { readonly data: MappedCurrentMaterialPreview; readonly ok: true }
  | { readonly error: z.ZodError; readonly ok: false } {
  const parsed = previewSchema.safeParse(value);
  if (!parsed.success) {
    return { error: parsed.error, ok: false };
  }
  const current = parsed.data;
  return {
    data: {
      access: current.metadata.access,
      contentVersion: current.contentVersion,
      formatId: current.metadata.formatId,
      materialId: current.materialId,
      publicationState: current.publicationState,
      preview: {
        accessLabel:
          current.metadata.access === "membership" ? "Для участников" : "Бесплатный",
        blocks: current.body.blocks,
        contentVersion: current.contentVersion,
        format: referenceLabel(
          current.metadata.formatId,
          references?.formats,
          "Формат не назначен",
        ),
        summary: current.metadata.summary ?? "Без описания",
        tags: current.metadata.tagIds.map(
          (tagId) =>
            references?.tags.find(({ value }) => value === tagId)?.label ?? "Тег назначен",
        ),
        title: current.metadata.title ?? "Без названия",
        topic: referenceLabel(
          current.metadata.topicId,
          references?.topics,
          "Тема не назначена",
        ),
        publicationState: current.publicationState,
      },
      seriesMemberships: current.metadata.seriesMemberships,
      slug: current.metadata.slug,
      summary: current.metadata.summary,
      tagIds: current.metadata.tagIds,
      title: current.metadata.title,
      topicId: current.metadata.topicId,
    },
    ok: true,
  };
}

function referenceLabel(
  id: string | null,
  options: readonly { readonly label: string; readonly value: string }[] | undefined,
  unassigned: string,
): string {
  return id === null
    ? unassigned
    : options?.find(({ value }) => value === id)?.label ?? "Значение назначено";
}
