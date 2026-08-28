/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class MaterialAuthoringService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
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
      expectedContentVersion: number;
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
      blocks: Array<any>;
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
        caption?: string;
        kind: 'image';
      } | {
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
}
