/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ProductWaitlistsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read the current intake identity without private membership or counts
   * @returns any
   * @throws ApiError
   */
  public readProductWaitlistIntake({
    productId,
  }: {
    productId: string,
  }): CancelablePromise<{
    intakeId: string;
    name: string;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/product-waitlists/{productId}/intake',
      path: {
        'productId': productId,
      },
    });
  }
  /**
   * Read only the current Account's waitlist membership
   * @returns any
   * @throws ApiError
   */
  public readProductWaitlistMembership({
    productId,
  }: {
    productId: string,
  }): CancelablePromise<{
    active: boolean;
    intakeId: string;
    name: string;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/product-waitlists/{productId}/membership',
      path: {
        'productId': productId,
      },
    });
  }
  /**
   * Complete an explicit waitlist action for the current Account
   * @returns any
   * @throws ApiError
   */
  public joinProductWaitlist({
    requestBody,
  }: {
    requestBody: {
      intakeId: string;
      operationId: string;
      source: string | null;
    },
  }): CancelablePromise<{
    active: boolean;
    intakeId: string;
    name: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/product-waitlists/join',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Withdraw the current Account without changing access or marketing preference
   * @returns any
   * @throws ApiError
   */
  public withdrawProductWaitlist({
    requestBody,
  }: {
    requestBody: {
      intakeId: string;
    },
  }): CancelablePromise<{
    active: boolean;
    intakeId: string;
    name: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/product-waitlists/withdraw',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
