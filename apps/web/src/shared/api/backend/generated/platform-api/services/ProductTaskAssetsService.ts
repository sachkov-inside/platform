/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ProductTaskAssetsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read a current Task asset through Task access
   * @returns void
   * @throws ApiError
   */
  public deliverProductTaskAsset({
    assetId,
    code,
    slug,
  }: {
    assetId: string,
    code: string,
    slug: string,
  }): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/library/products/{slug}/tasks/{code}/assets/{assetId}',
      path: {
        'assetId': assetId,
        'code': code,
        'slug': slug,
      },
      errors: {
        302: `Protected asset redirect`,
        401: `Optional Account proof is invalid`,
      },
    });
  }
}
