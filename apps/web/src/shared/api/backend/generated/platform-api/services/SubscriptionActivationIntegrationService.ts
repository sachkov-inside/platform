/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SubscriptionActivationIntegrationService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Persist an activation attempt for a verified private bot identity
   * @returns any
   * @throws ApiError
   */
  public beginSubscriptionActivation({
    requestBody,
  }: {
    requestBody: {
      attemptId: string;
      code: string;
      contractVersion: 'inside.subscription-activation.v1';
      identityRef: string;
    },
  }): CancelablePromise<({
    ok: boolean;
    value: {
      attemptId: string;
      contractVersion: 'inside.subscription-activation.v1';
      enrollment: {
        accountId: string;
        benefitTerms?: Array<{
          capability: string;
          endsAt: string | null;
          revoked: boolean;
          startsAt: string;
        }>;
        content?: Array<{
          available: boolean;
          id: string;
          kind: 'guide' | 'material';
          slug: string | null;
          title: string;
        }>;
        endPolicy: 'fixed' | 'confirmed_external' | 'temporary_membership';
        endsAt: string | null;
        history?: Array<{
          kind: string;
          reason: string;
          recordedAt: string;
        }>;
        id: string;
        nextChargeAt?: string | null;
        origin: 'course' | 'tribute' | 'manual' | 'platform_payment';
        renewal: 'not_applicable' | 'billing_agreement';
        revision: number;
        startsAt: string;
        state: 'scheduled' | 'active' | 'expired' | 'revoked' | 'pending_verification' | 'suspended_source';
        tier: {
          benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
          contentScope: {
            guideIds: Array<string>;
            materialIds: Array<string>;
          };
          id: string;
          name: string;
          revision: number;
        };
      } | null;
      rule?: {
        id: string;
        revision: number;
        sourceRef: string;
        verificationMode?: 'course_membership' | 'tribute_registry';
      };
      state: 'needs_account' | 'checking' | 'pending_review' | 'active' | 'already_active' | 'unavailable' | 'rejected';
    };
  } | {
    error: {
      code: 'invalid_input' | 'not_found' | 'policy_paused' | 'revision_conflict' | 'operation_conflict' | 'identity_conflict' | 'source_not_confirmed' | 'forbidden' | 'unavailable';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v1/subscription-activation/attempts',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read the exact current Platform binding for a verified source-authority identity
   * @returns any
   * @throws ApiError
   */
  public readSubscriptionActivationBinding({
    requestBody,
  }: {
    requestBody: {
      contractVersion: 'inside.subscription-activation.v1';
      identityRef: string;
    },
  }): CancelablePromise<({
    ok: boolean;
    value: ({
      binding: {
        accountRef: string;
        identityRef: string;
        linkRef: string;
        linkRevision: number;
      };
      contractVersion: 'inside.subscription-activation.v1';
      state: 'linked';
    } | {
      contractVersion: 'inside.subscription-activation.v1';
      state: 'unlinked';
    });
  } | {
    error: {
      code: 'invalid_input' | 'identity_conflict' | 'unavailable';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v1/subscription-activation/binding',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Apply bounded source proof to the exact current Account binding and rule revision
   * @returns any
   * @throws ApiError
   */
  public acceptSubscriptionActivationEvidence({
    requestBody,
  }: {
    requestBody: {
      accountRef: string;
      attemptId: string;
      audience: 'inside.platform.subscription-activation';
      checkedAt: any;
      contractVersion: 'inside.subscription-activation.v1';
      decision: 'member' | 'not_member' | 'unavailable' | 'registry_lookup';
      evidenceRef: string;
      identityRef: string;
      linkRef: string;
      linkRevision: number;
      ruleId: string;
      ruleRevision: number;
      sourceRef: string;
      validUntil: any;
    },
  }): CancelablePromise<({
    ok: boolean;
    value: {
      attemptId: string;
      contractVersion: 'inside.subscription-activation.v1';
      enrollment: {
        accountId: string;
        benefitTerms?: Array<{
          capability: string;
          endsAt: string | null;
          revoked: boolean;
          startsAt: string;
        }>;
        content?: Array<{
          available: boolean;
          id: string;
          kind: 'guide' | 'material';
          slug: string | null;
          title: string;
        }>;
        endPolicy: 'fixed' | 'confirmed_external' | 'temporary_membership';
        endsAt: string | null;
        history?: Array<{
          kind: string;
          reason: string;
          recordedAt: string;
        }>;
        id: string;
        nextChargeAt?: string | null;
        origin: 'course' | 'tribute' | 'manual' | 'platform_payment';
        renewal: 'not_applicable' | 'billing_agreement';
        revision: number;
        startsAt: string;
        state: 'scheduled' | 'active' | 'expired' | 'revoked' | 'pending_verification' | 'suspended_source';
        tier: {
          benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
          contentScope: {
            guideIds: Array<string>;
            materialIds: Array<string>;
          };
          id: string;
          name: string;
          revision: number;
        };
      } | null;
      rule?: {
        id: string;
        revision: number;
        sourceRef: string;
        verificationMode?: 'course_membership' | 'tribute_registry';
      };
      state: 'needs_account' | 'checking' | 'pending_review' | 'active' | 'already_active' | 'unavailable' | 'rejected';
    };
  } | {
    error: {
      code: 'invalid_input' | 'not_found' | 'policy_paused' | 'revision_conflict' | 'operation_conflict' | 'identity_conflict' | 'source_not_confirmed' | 'forbidden' | 'unavailable';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v1/subscription-activation/evidence',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read every independent access ground for the exact authenticated Telegram binding
   * @returns any
   * @throws ApiError
   */
  public readOwnSubscriptionAccess({
    requestBody,
  }: {
    requestBody: {
      accountRef: string;
      contractVersion: 'inside.subscription-activation.v1';
      identityRef: string;
      linkRef: string;
      linkRevision: number;
    },
  }): CancelablePromise<({
    ok: boolean;
    value: {
      admission: {
        admissionRestriction: 'none' | 'moderation' | 'external_unknown' | null;
        state: 'checking' | 'no_access' | 'moderation_blocked' | 'ready';
      };
      contractVersion: 'inside.subscription-activation.v1';
      enrollments: Array<{
        accountId: string;
        benefitTerms?: Array<{
          capability: string;
          endsAt: string | null;
          revoked: boolean;
          startsAt: string;
        }>;
        content?: Array<{
          available: boolean;
          id: string;
          kind: 'guide' | 'material';
          slug: string | null;
          title: string;
        }>;
        endPolicy: 'fixed' | 'confirmed_external' | 'temporary_membership';
        endsAt: string | null;
        history?: Array<{
          kind: string;
          reason: string;
          recordedAt: string;
        }>;
        id: string;
        nextChargeAt?: string | null;
        origin: 'course' | 'tribute' | 'manual' | 'platform_payment';
        renewal: 'not_applicable' | 'billing_agreement';
        revision: number;
        startsAt: string;
        state: 'scheduled' | 'active' | 'expired' | 'revoked' | 'pending_verification' | 'suspended_source';
        tier: {
          benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
          contentScope: {
            guideIds: Array<string>;
            materialIds: Array<string>;
          };
          id: string;
          name: string;
          revision: number;
        };
      }>;
      grounds: Array<{
        active: boolean;
        capabilities: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        source: 'paid' | 'manual' | 'legacy';
        startsAt: string;
        validUntil: string | null;
      }>;
    };
  } | {
    error: {
      code: 'invalid_input' | 'not_found' | 'policy_paused' | 'revision_conflict' | 'operation_conflict' | 'identity_conflict' | 'source_not_confirmed' | 'forbidden' | 'unavailable';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v1/subscription-activation/own-access',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
