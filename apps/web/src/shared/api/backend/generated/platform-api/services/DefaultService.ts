/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class DefaultService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read own delivery summaries without recipients or provider payloads
   * @returns any
   * @throws ApiError
   */
  public readOwnNotificationDeliveries({
    after,
  }: {
    after?: string,
  }): CancelablePromise<Array<{
    channel: 'email' | 'telegram';
    commandRevision: number;
    id: string;
    notificationId: string;
    reason: string | null;
    recoverySkipped: boolean;
    resultRevision: number;
    state: string;
    updatedAt: string;
  }>> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/notifications/deliveries',
      query: {
        'after': after,
      },
    });
  }
  /**
   * Read own material notification opt-ins
   * @returns any
   * @throws ApiError
   */
  public readNotificationPreferences(): CancelablePromise<{
    email: boolean;
    revision: number;
    telegram: boolean;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/notifications/preferences',
    });
  }
  /**
   * Change own channel opt-ins with revision and idempotency
   * @returns any
   * @throws ApiError
   */
  public changeNotificationPreferences({
    requestBody,
  }: {
    requestBody: {
      email: boolean;
      expectedRevision: number;
      operationId: any;
      telegram: boolean;
    },
  }): CancelablePromise<({
    ok: boolean;
    preferences: {
      email: boolean;
      revision: number;
      telegram: boolean;
    };
  } | {
    code: 'invalid_input' | 'revision_conflict' | 'operation_conflict';
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/notifications/preferences',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Authorize one correlated Telegram attempt against current source and binding
   * @returns any
   * @throws ApiError
   */
  public authorizeNotificationDispatch({
    requestBody,
  }: {
    requestBody: {
      attemptRef: any;
      commandRevision: number;
      contractVersion: 'inside.notification-dispatch.v1';
      deliveryOperationId: any;
      deliveryRef: any;
      operationId: any;
      payloadDigest: string;
    },
  }): CancelablePromise<({
    attemptRef: any;
    commandRevision: number;
    contractVersion: 'inside.notification-dispatch.v1';
    deliveryOperationId: any;
    deliveryRef: any;
    operationId: any;
    payloadDigest: string;
    permitRef: any;
    status: 'allowed';
    validUntil: string;
  } | {
    attemptRef: any;
    commandRevision: number;
    contractVersion: 'inside.notification-dispatch.v1';
    deliveryOperationId: any;
    deliveryRef: any;
    operationId: any;
    payloadDigest: string;
    reason: 'expired' | 'superseded' | 'preference_disabled' | 'access_denied' | 'binding_conflict' | 'not_found' | 'payload_conflict';
    status: 'denied';
  } | {
    attemptRef: any;
    code: 'malformed' | 'unauthorized' | 'unsupported_contract' | 'operation_conflict' | 'unavailable';
    commandRevision: number;
    contractVersion: 'inside.notification-dispatch.v1';
    deliveryOperationId: any;
    deliveryRef: any;
    operationId: any;
    payloadDigest: string;
    status: 'error';
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/internal/notifications/dispatch/authorize',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read delivery summaries as current Platform administrator
   * @returns any
   * @throws ApiError
   */
  public readOperatorNotificationDeliveries({
    accountId,
    after,
  }: {
    accountId: string,
    after?: string,
  }): CancelablePromise<Array<{
    channel: 'email' | 'telegram';
    commandRevision: number;
    id: string;
    notificationId: string;
    reason: string | null;
    recoverySkipped: boolean;
    resultRevision: number;
    state: string;
    updatedAt: string;
  }>> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/operations/notifications/accounts/{accountId}/deliveries',
      path: {
        'accountId': accountId,
      },
      query: {
        'after': after,
      },
    });
  }
  /**
   * Audit an administrator skip, preserving unknown and prohibiting resend
   * @returns any
   * @throws ApiError
   */
  public resolveUnknownNotificationDelivery({
    requestBody,
  }: {
    requestBody: {
      action: 'skip';
      deliveryRef: string;
      operationId: string;
    },
  }): CancelablePromise<{
    ok: boolean;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/operations/notifications/unknown/resolve',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
