/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class MaterialVideoAuthoringService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Attach an existing Video from the configured project
   * @returns any
   * @throws ApiError
   */
  public attachMaterialVideo({
    materialId,
    requestBody,
  }: {
    materialId: string,
    requestBody: {
      access: 'free' | 'membership' | 'workshop';
      providerVideoId: string;
    },
  }): CancelablePromise<{
    access: 'free' | 'membership' | 'workshop';
    failureCode?: string;
    materialId: string;
    origin: 'external_attachment' | 'platform_upload';
    state: 'uploading' | 'processing' | 'ready' | 'failed' | 'deletion_requested' | 'deleting' | 'deleted' | 'delete_failed';
    title: string;
    videoId: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/materials/{materialId}/videos/attach',
      path: {
        'materialId': materialId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Initialize a resumable primary Video upload
   * @returns any
   * @throws ApiError
   */
  public initMaterialVideoUpload({
    materialId,
    idempotencyKey,
    requestBody,
  }: {
    materialId: string,
    idempotencyKey: string,
    requestBody: {
      access: 'free' | 'membership' | 'workshop';
      byteSize: number;
      filename: string;
      title: string;
    },
  }): CancelablePromise<{
    uploadEndpoint: string;
    video: {
      access: 'free' | 'membership' | 'workshop';
      failureCode?: string;
      materialId: string;
      origin: 'external_attachment' | 'platform_upload';
      state: 'uploading' | 'processing' | 'ready' | 'failed' | 'deletion_requested' | 'deleting' | 'deleted' | 'delete_failed';
      title: string;
      videoId: string;
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/materials/{materialId}/videos/uploads',
      path: {
        'materialId': materialId,
      },
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Retry one failed owned Video deletion
   * @returns any
   * @throws ApiError
   */
  public retryMaterialVideoDeletion({
    videoId,
  }: {
    videoId: string,
  }): CancelablePromise<{
    access: 'free' | 'membership' | 'workshop';
    failureCode?: string;
    materialId: string;
    origin: 'external_attachment' | 'platform_upload';
    state: 'uploading' | 'processing' | 'ready' | 'failed' | 'deletion_requested' | 'deleting' | 'deleted' | 'delete_failed';
    title: string;
    videoId: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/videos/{videoId}/deletion-retries',
      path: {
        'videoId': videoId,
      },
    });
  }
  /**
   * Reconcile Video lifecycle from Kinescope
   * @returns any
   * @throws ApiError
   */
  public reconcileMaterialVideo({
    videoId,
  }: {
    videoId: string,
  }): CancelablePromise<{
    access: 'free' | 'membership' | 'workshop';
    failureCode?: string;
    materialId: string;
    origin: 'external_attachment' | 'platform_upload';
    state: 'uploading' | 'processing' | 'ready' | 'failed' | 'deletion_requested' | 'deleting' | 'deleted' | 'delete_failed';
    title: string;
    videoId: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/videos/{videoId}/reconcile',
      path: {
        'videoId': videoId,
      },
    });
  }
}
