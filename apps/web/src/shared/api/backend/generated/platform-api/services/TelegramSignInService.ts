/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class TelegramSignInService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Establish the Account and finalize the confirmed Telegram link
   * @returns any
   * @throws ApiError
   */
  public completeTelegramAccountSignIn(): CancelablePromise<{
    account: {
      accountId: string;
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v1/sign-in/complete',
    });
  }
  /**
   * Resolve an existing link for the trusted Logto connector
   * @returns any
   * @throws ApiError
   */
  public resolveTelegramLinkedIdentity({
    requestBody,
  }: {
    requestBody: {
      accountRef: string;
      subjectRef: string;
      telegramIdentityRef: string;
    },
  }): CancelablePromise<{
    issuer: string;
    subject: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v1/sign-in/linked-identity',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
