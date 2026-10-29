/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class MaterialAssetsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Download a file through current Material access
   * @returns binary Public immutable file bytes
   * @throws ApiError
   */
  public downloadMaterialAsset({
    contentVersion,
    assetId,
    materialId,
    preview,
  }: {
    contentVersion: number,
    assetId: string,
    materialId: string,
    preview?: boolean,
  }): CancelablePromise<Blob> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/materials/{materialId}/assets/{assetId}',
      path: {
        'assetId': assetId,
        'materialId': materialId,
      },
      query: {
        'preview': preview,
        'contentVersion': contentVersion,
      },
      errors: {
        302: `Short-lived protected redirect`,
        401: `Optional Account proof is invalid`,
        404: `Asset is absent or not currently accessible`,
        500: `Account resolution failed`,
        503: `Access or storage dependency is unavailable`,
      },
    });
  }
  /**
   * Read a responsive image through current Material access
   * @returns binary Public immutable image bytes
   * @throws ApiError
   */
  public readMaterialAssetImage({
    contentVersion,
    width,
    assetId,
    materialId,
    preview,
  }: {
    contentVersion: number,
    width: number,
    assetId: string,
    materialId: string,
    preview?: boolean,
  }): CancelablePromise<Blob> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/materials/{materialId}/assets/{assetId}/images/{width}',
      path: {
        'width': width,
        'assetId': assetId,
        'materialId': materialId,
      },
      query: {
        'preview': preview,
        'contentVersion': contentVersion,
      },
      errors: {
        302: `Short-lived protected redirect`,
        401: `Optional Account proof is invalid`,
        404: `Asset is absent or not currently accessible`,
        500: `Account resolution failed`,
        503: `Access or storage dependency is unavailable`,
      },
    });
  }
}
