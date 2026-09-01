/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class VideoPlaybackService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Authorize and create a short-lived Video playback session
   * @returns any
   * @throws ApiError
   */
  public createVideoPlaybackSession({
    videoId,
    materialId,
  }: {
    videoId: string,
    materialId: string,
  }): CancelablePromise<{
    drmAuthToken: string | null;
    embedLocator: string;
    progressScope: 'account' | 'anonymous';
    resumeSeconds: number | null;
    videoId: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/materials/{materialId}/videos/{videoId}/playback',
      path: {
        'videoId': videoId,
        'materialId': materialId,
      },
      errors: {
        401: `Optional Account proof is invalid`,
        500: `Account resolution failed`,
      },
    });
  }
  /**
   * Save coarse Account progress for one Video
   * @returns void
   * @throws ApiError
   */
  public saveVideoPlaybackProgress({
    videoId,
    materialId,
    requestBody,
  }: {
    videoId: string,
    materialId: string,
    requestBody: {
      durationSeconds: number;
      positionSeconds: number;
    },
  }): CancelablePromise<void> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/materials/{materialId}/videos/{videoId}/progress',
      path: {
        'videoId': videoId,
        'materialId': materialId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
