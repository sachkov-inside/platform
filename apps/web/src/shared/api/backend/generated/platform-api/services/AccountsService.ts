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
}
