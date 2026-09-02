/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RecursiveSchema1schema0 } from '../models/RecursiveSchema1schema0';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class MaterialAuthoringService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List Topics or Series for authoring
   * @returns any
   * @throws ApiError
   */
  public listAuthoringContentCollections({
    kind,
  }: {
    kind: 'series' | 'topic',
  }): CancelablePromise<Array<{
    archived: boolean;
    id: string;
    kind: 'series' | 'topic';
    materialCount: number;
    name: string;
    slug: string;
    summary: string;
    version: number;
  }>> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/collections',
      query: {
        'kind': kind,
      },
    });
  }
  /**
   * Create a Topic or Series with an immutable slug
   * @returns any
   * @throws ApiError
   */
  public createAuthoringContentCollection({
    requestBody,
  }: {
    requestBody: {
      kind: 'series' | 'topic';
      name: string;
      slug: string;
      summary: string;
    },
  }): CancelablePromise<{
    archived: boolean;
    id: string;
    kind: 'series' | 'topic';
    materialCount: number;
    name: string;
    slug: string;
    summary: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/collections',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Update Topic or Series metadata without changing its slug
   * @returns any
   * @throws ApiError
   */
  public updateAuthoringContentCollection({
    collectionId,
    requestBody,
  }: {
    collectionId: string,
    requestBody: {
      expectedVersion: number;
      kind: 'series' | 'topic';
      name: string;
      summary: string;
    },
  }): CancelablePromise<{
    archived: boolean;
    id: string;
    kind: 'series' | 'topic';
    materialCount: number;
    name: string;
    slug: string;
    summary: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/collections/{collectionId}',
      path: {
        'collectionId': collectionId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Archive or restore a Topic or Series
   * @returns any
   * @throws ApiError
   */
  public setAuthoringContentCollectionArchive({
    collectionId,
    requestBody,
  }: {
    collectionId: string,
    requestBody: {
      archived: boolean;
      expectedVersion: number;
      kind: 'series' | 'topic';
    },
  }): CancelablePromise<{
    archived: boolean;
    id: string;
    kind: 'series' | 'topic';
    materialCount: number;
    name: string;
    slug: string;
    summary: string;
    version: number;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/collections/{collectionId}/archive',
      path: {
        'collectionId': collectionId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * List the complete Material authoring corpus
   * @returns any
   * @throws ApiError
   */
  public listAuthoringMaterials({
    search,
    publicationState,
    page,
  }: {
    search?: string,
    publicationState?: 'draft' | 'published' | 'unpublished',
    page?: number,
  }): CancelablePromise<{
    items: Array<{
      canDelete: boolean;
      contentVersion: number;
      format: {
        id: string;
        name: string;
      } | null;
      materialId: string;
      publicationState: 'draft' | 'published' | 'unpublished';
      title: string | null;
      topic: {
        id: string;
        name: string;
      } | null;
      updatedAt: string;
    }>;
    page: number;
    pageSize: 20;
    totalItems: number;
    totalPages: number;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/materials',
      query: {
        'search': search,
        'publicationState': publicationState,
        'page': page,
      },
    });
  }
  /**
   * Create one current Material draft
   * @returns any
   * @throws ApiError
   */
  public createMaterialDraft({
    idempotencyKey,
    requestBody,
  }: {
    idempotencyKey: string,
    requestBody: {
      body: {
        doc: Record<string, any>;
        schemaVersion: 1;
      };
      metadata: {
        access: 'free' | 'membership';
        formatId: string | null;
        seriesIds: Array<string>;
        summary: string | null;
        tagIds: Array<string>;
        title: string | null;
        topicId: string | null;
      };
    },
  }): CancelablePromise<{
    contentVersion: number;
    materialId: string;
    publicationState: 'draft' | 'published' | 'unpublished';
    publishedAt: string | null;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/materials',
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Delete a never-published Material draft
   * @returns any
   * @throws ApiError
   */
  public deleteMaterialDraft({
    idempotencyKey,
    materialId,
    requestBody,
  }: {
    idempotencyKey: string,
    materialId: string,
    requestBody: {
      deleteVideoId: string | null;
      expectedContentVersion: number;
    },
  }): CancelablePromise<{
    materialId: string;
  }> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/authoring/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Load the current saved Material
   * @returns any
   * @throws ApiError
   */
  public loadCurrentMaterial({
    materialId,
  }: {
    materialId: string,
  }): CancelablePromise<{
    body: {
      doc: Record<string, any>;
      schemaVersion: 1;
    };
    contentVersion: number;
    firstPublishedAt: string | null;
    latestVideoDeletion: {
      failureCode?: string;
      origin: 'external_attachment' | 'platform_upload';
      state: 'uploading' | 'processing' | 'ready' | 'failed' | 'deletion_requested' | 'deleting' | 'deleted' | 'delete_failed';
      title: string;
      videoId: string;
    } | null;
    materialId: string;
    metadata: {
      access: 'free' | 'membership';
      formatId: string | null;
      seriesMemberships: Array<{
        ordinal: number;
        seriesId: string;
      }>;
      slug: string | null;
      summary: string | null;
      tagIds: Array<string>;
      title: string | null;
      topicId: string | null;
    };
    primaryVideo: {
      failureCode?: string;
      origin: 'external_attachment' | 'platform_upload';
      state: 'uploading' | 'processing' | 'ready' | 'failed' | 'deletion_requested' | 'deleting' | 'deleted' | 'delete_failed';
      title: string;
      videoId: string;
    } | null;
    primaryVideoId: string | null;
    publicationState: 'draft' | 'published' | 'unpublished';
    publishedAt: string | null;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
    });
  }
  /**
   * Atomically Save the complete current Material state
   * @returns any
   * @throws ApiError
   */
  public saveCurrentMaterial({
    idempotencyKey,
    materialId,
    requestBody,
  }: {
    idempotencyKey: string,
    materialId: string,
    requestBody: {
      body: {
        doc: Record<string, any>;
        schemaVersion: 1;
      };
      deleteVideoId: string | null;
      expectedContentVersion: number;
      metadata: {
        access: 'free' | 'membership';
        formatId: string | null;
        seriesIds: Array<string>;
        summary: string | null;
        tagIds: Array<string>;
        title: string | null;
        topicId: string | null;
      };
      primaryVideoId: string | null;
      publicationState: 'draft' | 'published' | 'unpublished';
    },
  }): CancelablePromise<{
    contentVersion: number;
    materialId: string;
    publicationState: 'draft' | 'published' | 'unpublished';
    publishedAt: string | null;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Upload and finalize an immutable Material asset
   * @returns any
   * @throws ApiError
   */
  public uploadMaterialAsset({
    idempotencyKey,
    materialId,
    formData,
  }: {
    idempotencyKey: string,
    materialId: string,
    formData: {
      checksumSha256: string;
      declaredSize: number;
      file: Blob;
      kind: 'file' | 'image';
    },
  }): CancelablePromise<{
    assetId: string;
    contentType: string;
    filename: string;
    height?: number;
    kind: 'file' | 'image';
    size: number;
    state: 'ready';
    variants?: Array<{
      height: number;
      width: number;
    }>;
    width?: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/materials/{materialId}/assets',
      path: {
        'materialId': materialId,
      },
      headers: {
        'idempotency-key': idempotencyKey,
      },
      formData: formData,
      mediaType: 'multipart/form-data',
    });
  }
  /**
   * Render the current saved Material
   * @returns any
   * @throws ApiError
   */
  public previewCurrentMaterial({
    materialId,
  }: {
    materialId: string,
  }): CancelablePromise<{
    body: {
      blocks: Array<RecursiveSchema1schema0>;
      schemaVersion: 1;
    };
    cacheScope: 'private-no-store';
    contentVersion: number;
    materialId: string;
    metadata: {
      access: 'free' | 'membership';
      formatId: string | null;
      seriesMemberships: Array<{
        ordinal: number;
        seriesId: string;
      }>;
      slug: string | null;
      summary: string | null;
      tagIds: Array<string>;
      title: string | null;
      topicId: string | null;
    };
    publicationState: 'draft' | 'published' | 'unpublished';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/materials/{materialId}/preview',
      path: {
        'materialId': materialId,
      },
    });
  }
  /**
   * Publish or unpublish the current Material without resending its content
   * @returns any
   * @throws ApiError
   */
  public transitionMaterialPublication({
    idempotencyKey,
    materialId,
    requestBody,
  }: {
    idempotencyKey: string,
    materialId: string,
    requestBody: {
      expectedContentVersion: number;
      publicationState: 'published' | 'unpublished';
    },
  }): CancelablePromise<{
    contentVersion: number;
    materialId: string;
    publicationState: 'draft' | 'published' | 'unpublished';
    publishedAt: string | null;
  }> {
    return this.httpRequest.request({
      method: 'PATCH',
      url: '/authoring/materials/{materialId}/publication',
      path: {
        'materialId': materialId,
      },
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Validate the current Material for publication
   * @returns any
   * @throws ApiError
   */
  public validateCurrentMaterial({
    expectedContentVersion,
    materialId,
  }: {
    expectedContentVersion: number,
    materialId: string,
  }): CancelablePromise<{
    contentVersion: number;
    extraction: {
      headings: Array<{
        level: (2 | 3 | 4);
        text: string;
      }>;
      plainText: string;
      resources: Array<({
        alt: string;
        assetId: string;
        caption?: string;
        kind: 'image';
      } | {
        assetId: string;
        kind: 'file';
        label: string;
      } | {
        caption?: string;
        kind: 'video';
      })>;
    };
    materialId: string;
    projectionDigest: string;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/materials/{materialId}/validation',
      path: {
        'materialId': materialId,
      },
      query: {
        'expectedContentVersion': expectedContentVersion,
      },
    });
  }
  /**
   * List the reference values available to a Material author
   * @returns any
   * @throws ApiError
   */
  public listMaterialAuthoringReferences(): CancelablePromise<{
    formats: Array<{
      archived: boolean;
      id: string;
      name: string;
    }>;
    series: Array<{
      archived: boolean;
      id: string;
      name: string;
    }>;
    tags: Array<{
      archived: boolean;
      id: string;
      name: string;
    }>;
    topics: Array<{
      archived: boolean;
      id: string;
      name: string;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/materials/references',
    });
  }
  /**
   * Load the current Material order for a Series
   * @returns any
   * @throws ApiError
   */
  public loadAuthoringSeriesOrder({
    seriesId,
  }: {
    seriesId: string,
  }): CancelablePromise<{
    archived: boolean;
    items: Array<{
      materialId: string;
      ordinal: number;
      publicationState: 'draft' | 'published' | 'unpublished';
      title: string | null;
    }>;
    name: string;
    orderVersion: string;
    seriesId: string;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/series/{seriesId}/order',
      path: {
        'seriesId': seriesId,
      },
    });
  }
  /**
   * Replace the Material order for a Series
   * @returns any
   * @throws ApiError
   */
  public reorderAuthoringSeries({
    seriesId,
    requestBody,
  }: {
    seriesId: string,
    requestBody: {
      expectedOrderVersion: string;
      orderedMaterialIds: Array<string>;
    },
  }): CancelablePromise<{
    orderVersion: string;
    seriesId: string;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/series/{seriesId}/order',
      path: {
        'seriesId': seriesId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
