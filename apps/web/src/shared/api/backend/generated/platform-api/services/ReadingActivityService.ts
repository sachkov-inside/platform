/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ReadingActivityService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read progress over the current published Guide composition
   * @returns any
   * @throws ApiError
   */
  public getGuideReadingProgress({
    guideId,
  }: {
    guideId: string,
  }): CancelablePromise<{
    allRead: boolean;
    read: number;
    seriesId: string;
    total: number;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/reading-activity/guides/{guideId}',
      path: {
        'guideId': guideId,
      },
    });
  }
  /**
   * Set the current Account's manual Material mark
   * @returns any
   * @throws ApiError
   */
  public setMaterialReadingState({
    materialId,
    requestBody,
  }: {
    materialId: string,
    requestBody: {
      commandId: string;
      expectedVersion: number;
      isRead: boolean;
    },
  }): CancelablePromise<{
    changed: boolean;
    replayed: boolean;
    state: {
      isRead: boolean;
      materialId: string;
      readAt: string | null;
      updatedAt: string | null;
      version: number;
    };
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/reading-activity/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read personal states for at most 100 Material IDs
   * @returns any
   * @throws ApiError
   */
  public getMaterialReadingStates({
    requestBody,
  }: {
    requestBody: {
      materialIds: Array<string>;
    },
  }): CancelablePromise<Array<{
    isRead: boolean;
    materialId: string;
    readAt: string | null;
    updatedAt: string | null;
    version: number;
  }>> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/reading-activity/materials/query',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * @deprecated
   * Read progress over the current published Series composition
   * @returns any
   * @throws ApiError
   */
  public getSeriesReadingProgress({
    seriesId,
  }: {
    seriesId: string,
  }): CancelablePromise<{
    allRead: boolean;
    read: number;
    seriesId: string;
    total: number;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/reading-activity/series/{seriesId}',
      path: {
        'seriesId': seriesId,
      },
    });
  }
}
