import "server-only";

import { z } from "zod";

import {
  materialDocumentSchema,
  type MaterialDraftPresentation,
} from "@/widgets/material-authoring/model";
import {
  BackendConnectionError,
  requestCurrentMaterial,
  requestMaterialAuthoringReferences,
  type BackendTransportResult,
} from "@/shared/api/backend/index.server";

import { getMaterialAuthoringReferences } from "@/features/material-authoring-references.server";
import { authoringVideoSchema } from "@/features/material-video/model/video";

const seriesMembershipSchema = z
  .object({ ordinal: z.number().int().positive(), seriesId: z.uuid() })
  .strict();
const currentMaterialSchema = z
  .object({
    body: z.object({ doc: materialDocumentSchema, schemaVersion: z.literal(1) }).strict(),
    contentVersion: z.number().int().positive(),
    firstPublishedAt: z.iso.datetime({ offset: true }).nullable(),
    materialId: z.uuid(),
    latestVideoDeletion: authoringVideoSchema.nullable(),
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
    primaryVideoId: z.uuid().nullable(),
    primaryVideo: authoringVideoSchema.nullable(),
    publishedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();
const problemSchema = z.object({ code: z.string(), correlationId: z.string().optional() }).loose();

export type CurrentMaterialState =
  | {
      readonly draft: MaterialDraftPresentation;
      readonly kind: "ready";
      readonly references: Awaited<
        ReturnType<typeof getMaterialAuthoringReferences>
      > & { readonly kind: "ready" };
    }
  | { readonly kind: "not_found" }
  | { readonly kind: "unauthorized" }
  | { readonly kind: "unexpected_error"; readonly reference: string };

export interface CurrentMaterialDependencies {
  readonly load: typeof requestCurrentMaterial;
  readonly references: typeof requestMaterialAuthoringReferences;
}

const productionDependencies: CurrentMaterialDependencies = {
  load: requestCurrentMaterial,
  references: requestMaterialAuthoringReferences,
};

export async function getCurrentMaterial(
  materialId: string,
  accessToken: string,
  dependencies: CurrentMaterialDependencies = productionDependencies,
): Promise<CurrentMaterialState> {
  const parsedMaterialId = z.uuid().safeParse(materialId);
  if (!parsedMaterialId.success) {
    return { kind: "not_found" };
  }

  let loaded: BackendTransportResult;
  let references: Awaited<ReturnType<typeof getMaterialAuthoringReferences>>;
  try {
    [loaded, references] = await Promise.all([
      dependencies.load(parsedMaterialId.data, accessToken),
      getMaterialAuthoringReferences(accessToken, dependencies.references),
    ]);
  } catch (error) {
    if (error instanceof BackendConnectionError && error.code === "unavailable") {
      return { kind: "unexpected_error", reference: error.code };
    }
    throw error;
  }
  if (!loaded.ok) {
    if (loaded.response.status === 401 || loaded.response.status === 403) {
      return { kind: "unauthorized" };
    }
    const problem = problemSchema.safeParse(loaded.problem);
    if (
      loaded.response.status === 404 &&
      problem.success &&
      problem.data.code === "material_not_found"
    ) {
      return { kind: "not_found" };
    }
    if (
      loaded.response.status === 503 &&
      problem.success &&
      problem.data.code === "dependency_unavailable"
    ) {
      return {
        kind: "unexpected_error",
        reference: problem.data.correlationId ?? problem.data.code,
      };
    }
    throw new TypeError("Unexpected Current Material response");
  }
  if (references.kind !== "ready") {
    return references.kind === "unauthorized"
      ? { kind: "unauthorized" }
      : { kind: "unexpected_error", reference: references.reference };
  }
  const parsed = currentMaterialSchema.safeParse(loaded.body);
  if (!parsed.success || parsed.data.materialId !== parsedMaterialId.data) {
    throw new TypeError("Malformed Current Material response");
  }

  return {
    draft: {
      access: parsed.data.metadata.access,
      canDelete:
        parsed.data.publicationState === "draft" &&
        parsed.data.firstPublishedAt === null,
      contentVersion: parsed.data.contentVersion,
      document: parsed.data.body.doc,
      formatId: parsed.data.metadata.formatId ?? "unassigned",
      materialId: parsed.data.materialId,
      deleteVideoId: null,
      latestVideoDeletion: parsed.data.latestVideoDeletion,
      primaryVideo: parsed.data.primaryVideo,
      primaryVideoId: parsed.data.primaryVideoId,
      readOnly: false,
      seriesIds: parsed.data.metadata.seriesMemberships.map(({ seriesId }) => seriesId),
      status: parsed.data.publicationState,
      summary: parsed.data.metadata.summary ?? "",
      tagIds: parsed.data.metadata.tagIds,
      title: parsed.data.metadata.title ?? "",
      topicId: parsed.data.metadata.topicId ?? "unassigned",
    },
    kind: "ready",
    references,
  };
}
