/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class AccountsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Establish an Account after verified Logto sign-in
   * @returns any
   * @throws ApiError
   */
  public establishAccount(): CancelablePromise<{
    account: {
      accountId: string;
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts',
    });
  }
  /**
   * Resolve an existing Account from a Logto access token
   * @returns any
   * @throws ApiError
   */
  public resolveCurrentAccount(): CancelablePromise<{
    account: {
      accountId: string;
    };
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current',
    });
  }
  /**
   * Record explicit acceptance of exact applicable document versions
   * @returns any
   * @throws ApiError
   */
  public acceptBillingConsents({
    requestBody,
  }: {
    requestBody: {
      buttonLabel: string;
      contextRef: string;
      documents: Array<{
        accepted: boolean;
        digest: string;
        documentId: string;
        kind: 'terms' | 'recurring' | 'personal_data' | 'marketing';
        version: string;
      }>;
      operationId: string;
      screen: 'checkout' | 'subscription-resume';
      shownTerms?: {
        amountKopecks: number;
        nextChargeOn: string;
        periodMonths: number;
      };
    },
  }): CancelablePromise<({
    evidenceRefs: Array<string>;
    ok: boolean;
  } | {
    error: {
      code: 'invalid_input' | 'forbidden' | 'revision_conflict' | 'operation_conflict' | 'rate_limited' | 'challenge_invalid' | 'contact_required' | 'document_changed' | 'not_found' | 'provider_unavailable' | 'internal_error';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/consents',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Recover own immutable accepted edition
   * @returns any
   * @throws ApiError
   */
  public readBillingConsent({
    evidenceRef,
  }: {
    evidenceRef: string,
  }): CancelablePromise<({
    evidence: {
      acceptedAt: string;
      buttonLabel: string | null;
      contextRef: string;
      document: {
        digest: string;
        documentId: string;
        kind: 'terms' | 'recurring' | 'personal_data' | 'marketing';
        text: string;
        url: string;
        version: string;
      };
      evidenceRef: string;
      shownTerms: {
        amountKopecks: number;
        nextChargeOn: string;
        periodMonths: number;
      } | null;
    };
    ok: boolean;
  } | {
    error: {
      code: 'invalid_input' | 'forbidden' | 'revision_conflict' | 'operation_conflict' | 'rate_limited' | 'challenge_invalid' | 'contact_required' | 'document_changed' | 'not_found' | 'provider_unavailable' | 'internal_error';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/billing/consents/{evidenceRef}',
      path: {
        'evidenceRef': evidenceRef,
      },
    });
  }
  /**
   * Read own verified receipt contact and applicable documents
   * @returns any
   * @throws ApiError
   */
  public readBillingContact(): CancelablePromise<({
    contact: {
      email: string;
      revision: number;
      verifiedAt: string;
    } | null;
    documents: Array<{
      readonly appliesTo: Array<'one_time' | 'subscription'>;
      digest: string;
      documentId: string;
      kind: 'terms' | 'recurring' | 'personal_data' | 'marketing';
      text: string;
      url: string;
      version: string;
    }>;
    ok: boolean;
  } | {
    error: {
      code: 'invalid_input' | 'forbidden' | 'revision_conflict' | 'operation_conflict' | 'rate_limited' | 'challenge_invalid' | 'contact_required' | 'document_changed' | 'not_found' | 'provider_unavailable' | 'internal_error';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/billing/contact',
    });
  }
  /**
   * Confirm the current email challenge without merging Accounts
   * @returns any
   * @throws ApiError
   */
  public confirmBillingContact({
    requestBody,
  }: {
    requestBody: {
      challengeRef: string;
      code: string;
      operationId: string;
    },
  }): CancelablePromise<({
    ok: boolean;
    revision: number;
  } | {
    error: {
      code: 'invalid_input' | 'forbidden' | 'revision_conflict' | 'operation_conflict' | 'rate_limited' | 'challenge_invalid' | 'contact_required' | 'document_changed' | 'not_found' | 'provider_unavailable' | 'internal_error';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/contact/confirm',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Send an Account-bound email verification code
   * @returns any
   * @throws ApiError
   */
  public startBillingContact({
    requestBody,
  }: {
    requestBody: {
      email: string;
      expectedRevision: number;
      operationId: string;
    },
  }): CancelablePromise<({
    challengeRef: string;
    delivery: 'sent' | 'unknown';
    expiresAt: string;
    ok: boolean;
  } | {
    error: {
      code: 'invalid_input' | 'forbidden' | 'revision_conflict' | 'operation_conflict' | 'rate_limited' | 'challenge_invalid' | 'contact_required' | 'document_changed' | 'not_found' | 'provider_unavailable' | 'internal_error';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/contact/start',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * List own accepted legal documents, newest first
   * @returns any
   * @throws ApiError
   */
  public listLegalAcceptances(): CancelablePromise<({
    documents: Array<{
      acceptanceRef: string;
      acceptedAt: string;
      buttonLabel: string | null;
      documentId: string;
      screen: 'first-sign-in' | 'checkout' | 'subscription-resume' | null;
      shownTerms: {
        amountKopecks: number;
        nextChargeOn: string;
        periodMonths: number;
      } | null;
      url: string;
      version: string;
    }>;
    ok: boolean;
  } | {
    error: {
      code: 'invalid_input' | 'forbidden' | 'document_changed' | 'operation_conflict' | 'internal_error';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/legal-acceptances',
    });
  }
  /**
   * Read whether the terms of use in force are accepted
   * @returns any
   * @throws ApiError
   */
  public readTermsAcceptance(): CancelablePromise<({
    accepted: boolean;
    document: {
      digest: string;
      documentId: 'terms';
      url: string;
      version: string;
    };
    ok: boolean;
    previouslyAccepted: boolean;
  } | {
    error: {
      code: 'invalid_input' | 'forbidden' | 'document_changed' | 'operation_conflict' | 'internal_error';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/legal-acceptances/terms',
    });
  }
  /**
   * Accept the exact terms of use edition in force by the pressed button
   * @returns any
   * @throws ApiError
   */
  public acceptTerms({
    requestBody,
  }: {
    requestBody: {
      buttonLabel: string;
      digest: string;
      operationId: string;
      version: string;
    },
  }): CancelablePromise<({
    acceptanceRef: string;
    ok: boolean;
  } | {
    error: {
      code: 'invalid_input' | 'forbidden' | 'document_changed' | 'operation_conflict' | 'internal_error';
    };
    ok: boolean;
  })> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/legal-acceptances/terms',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
