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
   * @returns any File bytes or a short-lived protected redirect
   * @throws ApiError
   */
  public downloadMaterialAsset({
    assetId,
    materialId,
    preview,
  }: {
    assetId: string,
    materialId: string,
    preview?: boolean,
  }): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/materials/{materialId}/assets/{assetId}',
      path: {
        'assetId': assetId,
        'materialId': materialId,
      },
      query: {
        'preview': preview,
      },
      errors: {
        401: `Optional Account proof is invalid`,
        404: `Asset is absent or not currently accessible`,
        500: `Account resolution failed`,
        503: `Access or storage dependency is unavailable`,
      },
    });
  }
  /**
   * Read a responsive image through current Material access
   * @returns any Image bytes or a short-lived protected redirect
   * @throws ApiError
   */
  public readMaterialAssetImage({
    width,
    assetId,
    materialId,
    preview,
  }: {
    width: number,
    assetId: string,
    materialId: string,
    preview?: boolean,
  }): CancelablePromise<any> {
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
      },
      errors: {
        401: `Optional Account proof is invalid`,
        500: `Account resolution failed`,
        503: `Account proof dependency is unavailable`,
      },
    });
  }
}
