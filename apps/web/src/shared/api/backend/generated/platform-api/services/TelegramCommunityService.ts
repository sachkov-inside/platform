/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class TelegramCommunityService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read the desired, accepted and applied community states of one Account
   * @returns any
   * @throws ApiError
   */
  public readCommunityEntitlementDelivery(): CancelablePromise<{
    desired: {
      access: ({
        kind: 'denied';
      } | {
        kind: 'finite';
        validUntil: string;
      } | {
        kind: 'lifetime';
      });
      entitlementRevision: number;
      nextBoundary: string | null;
      projectedAt: string;
      telegramIdentityRef: string | null;
    } | null;
    operations: Array<{
      access: ({
        kind: 'denied';
      } | {
        kind: 'finite';
        validUntil: string;
      } | {
        kind: 'lifetime';
      });
      appliedState: 'accepted' | 'waiting_for_join' | 'applied' | 'superseded' | 'failed' | 'unknown' | 'expired' | null;
      delivery: 'pending' | 'accepted' | 'rejected' | 'superseded';
      entitlementRevision: number;
      errorCode: string | null;
      issuedAt: string;
      observedMembership: 'member' | 'not_member' | 'unknown' | null;
      operationId: string;
      purpose: 'apply' | 'cleanup';
      updatedAt: string;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/community-entitlements/{accountId}',
    });
  }
  /**
   * Authorize one correlated Telegram community attempt against the current right and link
   * @returns any
   * @throws ApiError
   */
  public authorizeCommunityDispatch({
    requestBody,
  }: {
    requestBody: {
      attemptId: string;
      contractVersion: 'inside.billing-dispatch.v1';
      dispatchContractVersion: 'inside.community-entitlement.v1' | 'inside.billing-notification.v1';
      dispatchId: string;
      effect: 'community.ensure_admission' | 'community.approve_join' | 'community.ensure_absence' | 'notice.send';
      effectRef: string;
      operation: 'dispatch.authorize';
      operationId: string;
      payloadDigest: string;
    },
  }): CancelablePromise<{
    attemptId: string;
    contractVersion: 'inside.billing-dispatch.v1';
    decision: ({
      permitRef: string;
      status: 'allowed';
      validUntil: string;
    } | {
      reason: 'superseded' | 'binding_conflict' | 'expired' | 'not_found' | 'payload_conflict' | 'effect_conflict';
      status: 'denied';
    } | {
      status: 'unavailable';
    });
    dispatchId: string;
    operation: 'dispatch.result';
    operationId: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/internal/billing-dispatch/authorize',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
