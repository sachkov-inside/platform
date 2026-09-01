/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class KinescopeIntegrationService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * @returns any
   * @throws ApiError
   */
  public kinescopeIntegrationControllerAuthorize(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/kinescope/v1/authorize',
    });
  }
  /**
   * @returns any
   * @throws ApiError
   */
  public kinescopeIntegrationControllerWebhook(): CancelablePromise<any> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/kinescope/v1/webhook',
    });
  }
}
