/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ReadingActivityService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
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
   * Save how many parts of a step-by-step lesson the current Account has opened; the count only grows
   * @returns any
   * @throws ApiError
   */
  public recordLessonOpenedParts({
    materialId,
    requestBody,
  }: {
    materialId: string,
    requestBody: {
      openedParts: number;
    },
  }): CancelablePromise<{
    openedParts: number;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/reading-activity/materials/{materialId}/opened-parts',
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
    openedParts: number | null;
    readAt: string | null;
    updatedAt: string | null;
    updateNote: {
      notedAt: string;
      whatChanged: string;
    } | null;
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
   * Read progress over the current published Product composition
   * @returns any
   * @throws ApiError
   */
  public getProductReadingProgress({
    productId,
  }: {
    productId: string,
  }): CancelablePromise<{
    allRead: boolean;
    productId: string;
    read: number;
    total: number;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/reading-activity/products/{productId}',
      path: {
        'productId': productId,
      },
    });
  }
}
