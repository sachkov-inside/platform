/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class TelegramMembershipIntegrationService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Accept one authenticated normalized Membership Evidence envelope
   * @returns any
   * @throws ApiError
   */
  public acceptTelegramMembershipEvidence({
    xInsideMembershipEvidenceSource,
    idempotencyKey,
    requestBody,
  }: {
    xInsideMembershipEvidenceSource: 'link_time' | 'member_status_event' | 'reconciliation',
    idempotencyKey: string,
    requestBody: ({
      checkedAt: string;
      contractVersion: 'inside.membership-evidence.v1';
      decision: 'member';
      evidenceRef: string;
      evidenceVersion: number;
      principalRef: string;
      reasonCode: 'chat_member';
      telegramIdentityRef: string;
      validUntil: string;
    } | {
      checkedAt: string;
      contractVersion: 'inside.membership-evidence.v1';
      decision: 'not_member';
      evidenceRef: string;
      evidenceVersion: number;
      principalRef: string;
      reasonCode: 'chat_not_member';
      telegramIdentityRef: string;
      validUntil: string;
    } | {
      contractVersion: 'inside.membership-evidence.v1';
      decision: 'identity_not_linked';
      principalRef: string;
      reasonCode: 'identity_not_linked';
    } | {
      contractVersion: 'inside.membership-evidence.v1';
      decision: 'identity_conflict';
      principalRef: string;
      reasonCode: 'identity_conflict';
      telegramIdentityRef?: string;
    } | {
      contractVersion: 'inside.membership-evidence.v1';
      decision: 'unavailable';
      principalRef: string;
      reasonCode: 'provider_unavailable';
      telegramIdentityRef?: string;
    }),
  }): CancelablePromise<({
    evidenceVersion: number;
    ok: boolean;
    outcome: 'applied';
    state: 'active' | 'non_member';
  } | {
    decision: 'identity_not_linked' | 'identity_conflict' | 'unavailable';
    ok: boolean;
    outcome: 'accepted_without_entitlement';
  } | {
    evidenceVersion: number;
    ok: boolean;
    outcome: 'duplicate';
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v1/membership-evidence',
      headers: {
        'x-inside-membership-evidence-source': xInsideMembershipEvidenceSource,
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Envelope or contract version is invalid`,
        401: `Integration credential is invalid`,
        409: `Principal or evidence revision conflicts`,
        422: `Evidence is expired`,
        503: `Evidence application is unavailable`,
      },
    });
  }
}
