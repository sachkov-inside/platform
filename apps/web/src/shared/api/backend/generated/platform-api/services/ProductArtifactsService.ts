/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ProductArtifactsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read the artifact section of one Product through current access
   * @returns any
   * @throws ApiError
   */
  public readProductArtifacts({
    productId,
  }: {
    productId: string,
  }): CancelablePromise<{
    artifacts: Array<{
      artifactId: string;
      availability: 'available' | 'locked';
      content: ({
        contentType: string;
        filename: string;
        kind: 'file';
        size: number;
      } | {
        externalUrl: string | null;
        kind: 'link';
      });
      purpose: string;
      title: string;
      updatedAt: string;
      version: number;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/products/{productId}/artifacts',
      path: {
        'productId': productId,
      },
      errors: {
        401: `Optional Account proof is invalid`,
        404: `Product is absent`,
        500: `Account resolution failed`,
        503: `Access or storage dependency is unavailable`,
      },
    });
  }
  /**
   * Download one Product Artifact file through current access
   * @returns binary Public immutable file bytes
   * @throws ApiError
   */
  public downloadProductArtifact({
    version,
    artifactId,
    productId,
    preview,
  }: {
    version: number,
    artifactId: string,
    productId: string,
    preview?: boolean,
  }): CancelablePromise<Blob> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/products/{productId}/artifacts/{artifactId}/file',
      path: {
        'artifactId': artifactId,
        'productId': productId,
      },
      query: {
        'preview': preview,
        'version': version,
      },
      errors: {
        302: `Short-lived protected redirect`,
        401: `Optional Account proof is invalid`,
        404: `Artifact is absent or not currently accessible`,
        500: `Account resolution failed`,
        503: `Access or storage dependency is unavailable`,
      },
    });
  }
}
