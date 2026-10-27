/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class AccessService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Issue one lifetime Product Access explicitly as owner
   * @returns any
   * @throws ApiError
   */
  public issueProductAccess({
    requestBody,
  }: {
    requestBody: {
      accountId: string;
      productId: string;
      reason: string;
      sourceRef: string;
    },
  }): CancelablePromise<{
    ok: boolean;
    outcome: 'issued' | 'already_active' | 'revoked';
    value: {
      access: 'active' | 'revoked';
      accountId: string;
      firstIssuedAt: string | null;
      productId: string;
      revision: number;
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/access/products/issue',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read the bounded owner Product Access inventory
   * @returns any
   * @throws ApiError
   */
  public listProductAccess({
    requestBody,
  }: {
    requestBody: {
      access?: 'active' | 'revoked';
      accountId?: string;
      accountIds?: Array<string>;
      cursor?: string;
      limit: number;
      order?: 'recent';
      productId?: string;
    },
  }): CancelablePromise<{
    nextCursor: string | null;
    ok: boolean;
    value: Array<{
      access: 'active' | 'revoked';
      accountId: string;
      firstIssuedAt: string | null;
      productId: string;
      revision: number;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/access/products/list',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
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
        source: 'paid' | 'manual' | 'legacy' | 'course_activation' | 'unknown';
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
   * Read one Product Access with immutable source and action history
   * @returns any
   * @throws ApiError
   */
  public readProductAccess({
    requestBody,
  }: {
    requestBody: {
      accountId: string;
      productId: string;
    },
  }): CancelablePromise<{
    ok: boolean;
    value: {
      access: 'active' | 'revoked';
      accountId: string;
      actions: Array<{
        actorId: string | null;
        id: string;
        kind: string;
        reason: string;
        recordedAt: string;
        revision: number;
      }>;
      firstIssuedAt: string | null;
      productId: string;
      revision: number;
      sources: Array<{
        issuedAt: string;
        reason: string;
        source: string;
        sourceRef: string;
      }>;
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/access/products/read',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Explicit owner restoration of lifetime Product Access
   * @returns any
   * @throws ApiError
   */
  public restoreProductAccess({
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
      access: 'active' | 'revoked';
      accountId: string;
      firstIssuedAt: string | null;
      productId: string;
      revision: number;
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/admin/access/products/restore',
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
      firstIssuedAt: string | null;
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
  /**
   * Read one Product's holders newest first with their learning progress, without names or emails
   * @returns any
   * @throws ApiError
   */
  public listProductHolders({
    productId,
    accountIds,
    access,
    limit,
    cursor,
  }: {
    productId: string,
    /**
     * Only these Accounts (repeat the parameter, at most 50); an Account without access is absent
     */
    accountIds?: Array<string>,
    access?: 'active' | 'revoked',
    limit?: number,
    cursor?: string,
  }): CancelablePromise<{
    items: Array<{
      access: 'active' | 'revoked';
      accountId: string;
      firstIssuedAt: string | null;
      learning: {
        /**
         * The latest open of a programme Material; null when none
         */
        lastActivityAt: string | null;
        /**
         * Programme Materials marked read, the rule of Product progress
         */
        readCount: number;
        /**
         * When the Account started the Product; null until it does
         */
        startedAt: string | null;
        /**
         * Published programme Materials, the rule of Product progress
         */
        totalCount: number;
      };
      revision: number;
    }>;
    nextCursor: string | null;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/admin/products/{productId}/holders',
      path: {
        'productId': productId,
      },
      query: {
        'accountIds': accountIds,
        'access': access,
        'limit': limit,
        'cursor': cursor,
      },
    });
  }
}
