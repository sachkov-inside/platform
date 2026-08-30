/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ContentLibraryService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List safe published Material projections
   * @returns any A deterministic page of published Materials
   * @throws ApiError
   */
  public listPublishedMaterials({
    sort,
    series,
    format,
    topic,
    q,
    after,
  }: {
    sort?: 'newest' | 'relevance' | 'title',
    series?: Array<string>,
    format?: Array<string>,
    topic?: Array<string>,
    q?: string,
    after?: string,
  }): CancelablePromise<{
    facets: {
      formats: Array<{
        count: number;
        id: string;
        name: string;
        slug: string;
      }>;
      series: Array<{
        count: number;
        id: string;
        name: string;
        slug: string;
      }>;
      topics: Array<{
        count: number;
        id: string;
        name: string;
        slug: string;
      }>;
    };
    items: Array<{
      access: 'free' | 'membership';
      availability: 'available' | 'locked' | 'unavailable';
      contentVersion: number;
      format: {
        id: string;
        name: string;
        slug: string;
      };
      materialId: string;
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
    }>;
    nextCursor: string | null;
    totalCount: number;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/library/materials',
      query: {
        'sort': sort,
        'series': series,
        'format': format,
        'topic': topic,
        'q': q,
        'after': after,
      },
      errors: {
        400: `Catalog query is malformed`,
        401: `Optional Account proof is invalid`,
        500: `Catalog or Account resolution failed internally`,
        503: `Catalog or Account proof dependency is unavailable`,
      },
    });
  }
}
