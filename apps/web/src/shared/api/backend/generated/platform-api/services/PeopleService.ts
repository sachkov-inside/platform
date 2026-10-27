/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class PeopleService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read how the owner sees each of up to 100 known Accounts, in the requested order; an Account that is not a person is omitted
   * @returns any
   * @throws ApiError
   */
  public readPeopleIdentities({
    accountIds,
  }: {
    /**
     * 1–100 Account IDs separated by commas
     */
    accountIds: string,
  }): CancelablePromise<{
    items: Array<{
      accountId: string;
      contactsState: 'complete' | 'partial';
      displayName: string | null;
      email: string | null;
      username: string | null;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/people/identities',
      query: {
        'accountIds': accountIds,
      },
    });
  }
  /**
   * Find people for the owner by Account ID, by exact email or by Telegram name and @username; Accounts without a Sign-in Email, verified Billing Contact or Telegram link are never found
   * @returns any
   * @throws ApiError
   */
  public searchPeople({
    query,
    limit,
  }: {
    /**
     * Trimmed, 1–160 characters. A UUID is an Account ID, an address is matched exactly, other text is a name or @username
     */
    query: string,
    limit?: number,
  }): CancelablePromise<{
    items: Array<{
      accountId: string;
      contactsState: 'complete' | 'partial';
      displayName: string | null;
      email: string | null;
      username: string | null;
    }>;
    nameSearch: 'available' | 'unavailable';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/people/search',
      query: {
        'limit': limit,
        'query': query,
      },
    });
  }
}
