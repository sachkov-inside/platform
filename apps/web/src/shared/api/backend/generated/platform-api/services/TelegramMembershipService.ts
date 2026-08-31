/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class TelegramMembershipService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
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
        404: `No link belongs to this Account`,
        503: `Identity verification is unavailable`,
      },
    });
  }
}
