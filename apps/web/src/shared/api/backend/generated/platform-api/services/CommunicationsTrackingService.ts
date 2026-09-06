/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class CommunicationsTrackingService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Resolve an opaque public link and persist a visit without granting content access
   * @returns any
   * @throws ApiError
   */
  public resolveCommunicationVisit({
    requestBody,
  }: {
    requestBody: {
      token: string;
      traffic: 'unknown' | 'known_automation';
    },
  }): CancelablePromise<({
    kind: 'resolved';
    safeUrl: string;
  } | {
    kind: 'invalid' | 'not_found' | 'unavailable';
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/communications/tracking/resolve',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
