/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class KinescopeIntegrationService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Repeat the member access decision for a Kinescope DRM request
   * @returns any
   * @throws ApiError
   */
  public authorizeKinescopeVideoPlayback({
    requestBody,
  }: {
    requestBody: Record<string, any>,
  }): CancelablePromise<{
    authorized: boolean;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/kinescope/v1/authorize',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Accept and durably reconcile a Kinescope Video status event
   * @returns any
   * @throws ApiError
   */
  public acceptKinescopeVideoWebhook({
    requestBody,
  }: {
    requestBody: Record<string, any>,
  }): CancelablePromise<{
    accepted: boolean;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/kinescope/v1/webhook',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
