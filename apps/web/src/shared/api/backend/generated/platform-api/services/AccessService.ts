/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class AccessService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Preview all current grounds affected by one Product revocation
   * @returns any
   * @throws ApiError
   */
  public previewProductAccessRevocation({
    requestBody,
  }: {
    requestBody: {
      accountId: string;
      productId: string;
    },
  }): CancelablePromise<{
    ok: boolean;
    value: {
      accountId: string;
      affected: Array<{
        capabilities: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        source: 'paid' | 'manual' | 'legacy';
        validUntil: string | null;
      }>;
      affectedCount: number;
      productId: string;
      revision: number;
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/access/products/preview-revoke',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Revoke a selected Product across its existing access grounds
   * @returns any
   * @throws ApiError
   */
  public revokeProductAccess({
    requestBody,
  }: {
    requestBody: {
      accountId: string;
      expectedRevision: number;
      operationId: string;
      productId: string;
      reason: string;
    },
  }): CancelablePromise<{
    ok: boolean;
    value: {
      access: 'revoked';
      accountId: string;
      productId: string;
      revision: number;
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/access/products/revoke',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
