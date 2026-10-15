/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class TelegramMembershipService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Continue a selected activation for the current Account binding
   * @returns any
   * @throws ApiError
   */
  public readTelegramActivationContinuation({
    attemptId,
  }: {
    attemptId: string,
  }): CancelablePromise<({
    state: 'expired' | 'identity_conflict' | 'unavailable';
  } | {
    product: {
      id: string;
      name: string;
      slug: string;
    };
    state: 'link_required' | 'pending' | 'active';
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/telegram-activation/{attemptId}',
      path: {
        'attemptId': attemptId,
      },
      errors: {
        403: `The terms of use in force are not accepted yet`,
        500: `Terms acceptance could not be checked`,
      },
    });
  }
  /**
   * Begin a Telegram Membership link for the current Account
   * @returns any
   * @throws ApiError
   */
  public beginTelegramMembershipLink(): CancelablePromise<{
    deepLink?: string;
    expiresAt: string;
    linkRef: string;
    status: 'conflict' | 'expired' | 'linked' | 'pending' | 'recovery-required' | 'replayed' | 'unavailable';
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/telegram-link',
      errors: {
        401: `Account proof is missing or invalid`,
        403: `The terms of use in force are not accepted yet`,
        500: `Terms acceptance could not be checked`,
        503: `Identity verification is unavailable`,
      },
    });
  }
  /**
   * Confirm the Telegram receipt for the original Account
   * @returns any
   * @throws ApiError
   */
  public confirmTelegramMembershipLink({
    linkRef,
  }: {
    linkRef: string,
  }): CancelablePromise<{
    deepLink?: string;
    expiresAt: string;
    linkRef: string;
    status: 'conflict' | 'expired' | 'linked' | 'pending' | 'recovery-required' | 'replayed' | 'unavailable';
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/telegram-link/{linkRef}/confirm',
      path: {
        'linkRef': linkRef,
      },
      errors: {
        400: `The link reference is invalid`,
        401: `Account proof is missing or invalid`,
        403: `The terms of use in force are not accepted yet`,
        404: `No link belongs to this Account`,
        500: `Terms acceptance could not be checked`,
        503: `Identity verification is unavailable`,
      },
    });
  }
  /**
   * Read Telegram linking and Membership states for the current Account
   * @returns any
   * @throws ApiError
   */
  public readCurrentAccountTelegramMembership(): CancelablePromise<{
    link: ({
      kind: 'unlinked';
    } | {
      expiresAt: string;
      kind: 'linking';
      linkRef: string;
    } | {
      kind: 'linked';
    } | {
      kind: 'conflict';
      supportUrl?: string;
    } | {
      kind: 'retryable';
      reason: 'expired' | 'replayed';
    } | {
      kind: 'unavailable';
      retry: ({
        kind: 'confirm';
        linkRef: string;
      } | {
        kind: 'refresh';
      });
    } | {
      kind: 'recovery-required';
      recovery: {
        kind: 'support';
        url?: string;
      };
    });
    membership: ({
      kind: 'active';
    } | {
      kind: 'inactive';
    } | {
      kind: 'stale';
    } | {
      kind: 'notOffered';
    } | {
      kind: 'unavailable';
    });
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/telegram-membership',
      errors: {
        401: `Account proof is missing or invalid`,
        403: `The terms of use in force are not accepted yet`,
        500: `Terms acceptance could not be checked`,
        503: `Account Membership presentation is unavailable`,
      },
    });
  }
  /**
   * Read public Product navigation metadata without identity or access details
   * @returns any
   * @throws ApiError
   */
  public readTelegramActivationIntent({
    attemptId,
  }: {
    attemptId: string,
  }): CancelablePromise<({
    state: 'unavailable';
  } | {
    product: {
      id: string;
      name: string;
      slug: string;
    };
    state: 'ready' | 'expired';
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/telegram-activation-intents/{attemptId}',
      path: {
        'attemptId': attemptId,
      },
    });
  }
}
