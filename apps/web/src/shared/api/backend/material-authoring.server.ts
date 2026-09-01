import "server-only";

import { MaterialAuthoringService } from "./generated/platform-api";
import { executeGeneratedRequest, type BackendTransportResult } from "./transport-core.server";

export function requestAuthoringMaterials(query: { readonly page: number; readonly publicationState?: "draft" | "published" | "unpublished"; readonly search?: string }, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest((request) => new MaterialAuthoringService(request).listAuthoringMaterials(query), 200, { accessToken });
}

export type ContentCollectionKind = "series" | "topic";

export function requestContentCollections(kind: ContentCollectionKind, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialAuthoringService(request).listAuthoringContentCollections({ kind }),
    200,
    { accessToken },
  );
}

export function requestContentCollectionCreation(input: { readonly kind: ContentCollectionKind; readonly name: string; readonly slug: string; readonly summary: string }, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialAuthoringService(request).createAuthoringContentCollection({ requestBody: input }),
    201,
    { accessToken },
  );
}

export function requestContentCollectionUpdate(input: { readonly collectionId: string; readonly expectedVersion: number; readonly kind: ContentCollectionKind; readonly name: string; readonly summary: string }, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialAuthoringService(request).updateAuthoringContentCollection({
      collectionId: input.collectionId,
      requestBody: {
        expectedVersion: input.expectedVersion,
        kind: input.kind,
        name: input.name,
        summary: input.summary,
      },
    }),
    200,
    { accessToken },
  );
}

export function requestContentCollectionArchive(input: { readonly archived: boolean; readonly collectionId: string; readonly expectedVersion: number; readonly kind: ContentCollectionKind }, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialAuthoringService(request).setAuthoringContentCollectionArchive({
      collectionId: input.collectionId,
      requestBody: {
        archived: input.archived,
        expectedVersion: input.expectedVersion,
        kind: input.kind,
      },
    }),
    200,
    { accessToken },
  );
}

export function requestMaterialDraftCreation(input: { readonly access: "free" | "membership"; readonly document: Record<string, unknown>; readonly formatId: string | null; readonly idempotencyKey: string; readonly seriesIds: readonly string[]; readonly summary: string; readonly tagIds: readonly string[]; readonly title: string; readonly topicId: string | null }, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialAuthoringService(request).createMaterialDraft({
      idempotencyKey: input.idempotencyKey,
      requestBody: {
        body: { doc: input.document, schemaVersion: 1 },
        metadata: { access: input.access, formatId: input.formatId, seriesIds: [...input.seriesIds], summary: input.summary, tagIds: [...input.tagIds], title: input.title, topicId: input.topicId },
      },
    }),
    201,
    { accessToken },
  );
}

export function requestCurrentMaterial(materialId: string, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest((request) => new MaterialAuthoringService(request).loadCurrentMaterial({ materialId }), 200, { accessToken });
}

export function requestMaterialSave(input: { readonly access: "free" | "membership"; readonly document: Record<string, unknown>; readonly expectedContentVersion: number; readonly formatId: string | null; readonly idempotencyKey: string; readonly materialId: string; readonly publicationState: "draft" | "published" | "unpublished"; readonly seriesIds: readonly string[]; readonly summary: string | null; readonly tagIds: readonly string[]; readonly title: string | null; readonly topicId: string | null }, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialAuthoringService(request).saveCurrentMaterial({
      idempotencyKey: input.idempotencyKey,
      materialId: input.materialId,
      requestBody: {
        body: { doc: input.document, schemaVersion: 1 },
        expectedContentVersion: input.expectedContentVersion,
        metadata: { access: input.access, formatId: input.formatId, seriesIds: [...input.seriesIds], summary: input.summary, tagIds: [...input.tagIds], title: input.title, topicId: input.topicId },
        publicationState: input.publicationState,
      },
    }),
    200,
    { accessToken },
  );
}

export function requestMaterialPublicationTransition(input: { readonly expectedContentVersion: number; readonly idempotencyKey: string; readonly materialId: string; readonly publicationState: "published" | "unpublished" }, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialAuthoringService(request).transitionMaterialPublication({ idempotencyKey: input.idempotencyKey, materialId: input.materialId, requestBody: { expectedContentVersion: input.expectedContentVersion, publicationState: input.publicationState } }),
    200,
    { accessToken },
  );
}

export function requestMaterialDeletion(input: { readonly expectedContentVersion: number; readonly idempotencyKey: string; readonly materialId: string }, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new MaterialAuthoringService(request).deleteMaterialDraft({ idempotencyKey: input.idempotencyKey, materialId: input.materialId, requestBody: { expectedContentVersion: input.expectedContentVersion } }),
    200,
    { accessToken },
  );
}

export function requestMaterialAuthoringReferences(accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest((request) => new MaterialAuthoringService(request).listMaterialAuthoringReferences(), 200, { accessToken });
}

export function requestSeriesOrder(seriesId: string, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest((request) => new MaterialAuthoringService(request).loadAuthoringSeriesOrder({ seriesId }), 200, { accessToken });
}

export function requestSeriesReorder(input: { readonly expectedOrderVersion: string; readonly orderedMaterialIds: readonly string[]; readonly seriesId: string }, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest((request) => new MaterialAuthoringService(request).reorderAuthoringSeries({ seriesId: input.seriesId, requestBody: { expectedOrderVersion: input.expectedOrderVersion, orderedMaterialIds: [...input.orderedMaterialIds] } }), 200, { accessToken });
}

export function requestMaterialValidation(materialId: string, contentVersion: number, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest((request) => new MaterialAuthoringService(request).validateCurrentMaterial({ expectedContentVersion: contentVersion, materialId }), 200, { accessToken });
}

export function requestMaterialPreview(materialId: string, accessToken: string): Promise<BackendTransportResult> {
  return executeGeneratedRequest((request) => new MaterialAuthoringService(request).previewCurrentMaterial({ materialId }), 200, { accessToken });
}
