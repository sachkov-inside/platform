/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class BookmarksService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Remove a Material from the current Account's bookmarks
   * @returns any
   * @throws ApiError
   */
  public removeMaterialBookmark({
    materialId,
  }: {
    materialId: string,
  }): CancelablePromise<{
    bookmarked: boolean;
    bookmarkedAt: string | null;
    materialId: string;
  }> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/bookmarks/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
    });
  }
  /**
   * Add a Material to the current Account's bookmarks
   * @returns any
   * @throws ApiError
   */
  public addMaterialBookmark({
    materialId,
  }: {
    materialId: string,
  }): CancelablePromise<{
    bookmarked: boolean;
    bookmarkedAt: string | null;
    materialId: string;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/bookmarks/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
    });
  }
  /**
   * Read bookmark states for at most 100 Material IDs
   * @returns any
   * @throws ApiError
   */
  public getMaterialBookmarkStates({
    requestBody,
  }: {
    requestBody: {
      materialIds: Array<string>;
    },
  }): CancelablePromise<Array<{
    bookmarked: boolean;
    bookmarkedAt: string | null;
    materialId: string;
  }>> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/bookmarks/materials/query',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * List the current Account's bookmarked Materials, newest first
   * @returns any
   * @throws ApiError
   */
  public listBookmarks({
    requestBody,
  }: {
    requestBody: {
      after?: string;
      first: number;
    },
  }): CancelablePromise<{
    items: Array<{
      access: 'free' | 'membership' | 'workshop';
      availability: 'available' | 'locked' | 'unavailable';
      contentVersion: number;
      cover: {
        coverId: string;
        renditions: Array<{
          height: number;
          width: number;
        }>;
      } | null;
      difficulty: 'basic' | 'intermediate' | 'advanced' | null;
      format: {
        id: 'video' | 'guide' | 'note';
        name: string;
        slug: 'video' | 'guide' | 'note';
      };
      materialId: string;
      outcomes: Array<string>;
      primaryVideoDurationSeconds?: number;
      primaryVideoId: string | null;
      publishedAt: string;
      seriesMemberships: Array<{
        ordinal: number;
        series: {
          id: string;
          name: string;
          slug: string;
        };
        stepGroup?: string | null;
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
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/bookmarks/query',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
