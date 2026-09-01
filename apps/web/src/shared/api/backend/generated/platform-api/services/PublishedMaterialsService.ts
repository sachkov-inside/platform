/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RecursiveSchema0schema0 } from '../models/RecursiveSchema0schema0';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class PublishedMaterialsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read the current published Material
   * @returns any Published Material body or an access-safe teaser
   * @throws ApiError
   */
  public readPublishedMaterial({
    slug,
  }: {
    slug: string,
  }): CancelablePromise<({
    body: {
      blocks: Array<RecursiveSchema0schema0>;
      schemaVersion: 1;
    };
    cacheScope: 'public' | 'private-no-store';
    kind: 'available';
    primaryVideo: {
      failureCode?: string;
      state: 'uploading' | 'processing' | 'ready' | 'failed';
      title: string;
      videoId: string;
    } | null;
    projection: {
      access: 'free' | 'membership';
      contentVersion: number;
      format: {
        id: string;
        name: string;
        slug: string;
      };
      materialId: string;
      primaryVideoId: string | null;
      publishedAt: string;
      seriesMemberships: Array<{
        ordinal: number;
        series: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string;
      tags: Array<{
        id: string;
        name: string;
      }>;
      title: string;
      topic: {
        id: string;
        name: string;
        slug: string;
      };
    };
  } | {
    access: {
      availability: 'locked';
      cta: {
        label: 'Получить доступ';
        url: string;
      };
    };
    cacheScope: 'public' | 'private-no-store';
    kind: 'teaser';
    projection: {
      access: 'free' | 'membership';
      contentVersion: number;
      format: {
        id: string;
        name: string;
        slug: string;
      };
      materialId: string;
      primaryVideoId: string | null;
      publishedAt: string;
      seriesMemberships: Array<{
        ordinal: number;
        series: {
          id: string;
          name: string;
          slug: string;
        };
      }>;
      slug: string;
      summary: string;
      tags: Array<{
        id: string;
        name: string;
      }>;
      title: string;
      topic: {
        id: string;
        name: string;
        slug: string;
      };
    };
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/materials/{slug}',
      path: {
        'slug': slug,
      },
      errors: {
        400: `Published Material request is malformed`,
        401: `Optional Account proof is invalid`,
        404: `Published Material does not exist`,
        500: `Published Material read or Account resolution failed unexpectedly`,
        503: `Published Material or Account proof dependency is unavailable`,
      },
    });
  }
}
