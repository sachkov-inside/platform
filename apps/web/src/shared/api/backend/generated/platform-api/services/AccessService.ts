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
      accountId?: string;
      cursor?: string;
      limit: number;
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
}
