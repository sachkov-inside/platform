import "server-only";

import {
  ContentLibraryService,
  PublishedMaterialsService,
} from "./generated/platform-api";
import {
  executeGeneratedRequest,
  type BackendTransportResult,
} from "./transport-core.server";

interface PublicRequestOptions {
  readonly accessToken?: string;
  readonly signal?: AbortSignal;
}

export function requestPublishedMaterialCatalog(
  query: {
    readonly after?: string;
    readonly canonicalTopic?: string;
    readonly format?: readonly string[];
    readonly q?: string;
    readonly series?: readonly string[];
    readonly sort?: "newest" | "relevance" | "series" | "title";
    readonly topic?: readonly string[];
  },
  options: PublicRequestOptions = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ContentLibraryService(request).listPublishedMaterials({
        ...(query.after === undefined ? {} : { after: query.after }),
        ...(query.canonicalTopic === undefined
          ? {}
          : { canonicalTopic: query.canonicalTopic }),
        ...(query.format === undefined ? {} : { format: [...query.format] }),
        ...(query.q === undefined ? {} : { q: query.q }),
        ...(query.series === undefined ? {} : { series: [...query.series] }),
        ...(query.sort === undefined ? {} : { sort: query.sort }),
        ...(query.topic === undefined ? {} : { topic: [...query.topic] }),
      }),
    200,
    options,
  );
}

export function requestPublishedTopic(
  slug: string,
  options: PublicRequestOptions = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new ContentLibraryService(request).readPublishedTopic({ slug }),
    200,
    options,
  );
}

export function requestPublishedSeries(
  slug: string,
  options: PublicRequestOptions = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) => new ContentLibraryService(request).readPublishedSeries({ slug }),
    200,
    options,
  );
}

export function requestRelatedPublishedMaterials(
  slug: string,
  options: PublicRequestOptions = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new ContentLibraryService(request).readRelatedPublishedMaterials({ slug }),
    200,
    options,
  );
}

export function requestPublishedMaterial(
  slug: string,
  options: PublicRequestOptions = {},
): Promise<BackendTransportResult> {
  return executeGeneratedRequest(
    (request) =>
      new PublishedMaterialsService(request).readPublishedMaterial({ slug }),
    200,
    options,
  );
}
