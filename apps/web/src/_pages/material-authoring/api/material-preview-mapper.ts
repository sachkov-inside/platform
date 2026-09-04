import "server-only";

import { z } from "zod";

import { renderedMaterialBodySchema } from "@/entities/material.model";
import type { MaterialPreviewPresentation } from "@/widgets/material-authoring/model";

import type { MaterialAuthoringReferences } from "@/features/material-authoring-references.server";

const seriesMembershipSchema = z
  .object({ ordinal: z.number().int().positive(), seriesId: z.uuid() })
  .strict();

const previewSchema = z
  .object({
    body: renderedMaterialBodySchema,
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
        materialId: current.materialId,
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
