/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class AuthoringSearchService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Search the authoring groups the account may read, in a fixed order (people, products, materials, payments): at most five hits per group; a group whose dependency failed answers unavailable; an account that may read no group is refused
   * @returns any
   * @throws ApiError
   */
  public searchAuthoring({
    query,
  }: {
    /**
     * Trimmed, 1–160 characters; whitespace runs count as one space
     */
    query: string,
  }): CancelablePromise<{
    groups: Array<(({
      items: Array<{
        accountId: string;
        contactsState: 'complete' | 'partial';
        displayName: string | null;
        email: string | null;
        username: string | null;
      }>;
      kind: 'people';
      /**
       * Name and @username search was unavailable
       */
      partial: boolean;
      state: 'ready';
      /**
       * More people matched than the group shows; a more precise text finds the rest
       */
      truncated: boolean;
    } | {
      items: Array<{
        archived: boolean;
        id: string;
        name: string;
      }>;
      kind: 'products';
      state: 'ready';
    } | {
      items: Array<{
        id: string;
        publicationState: 'draft' | 'published' | 'unpublished';
        title: string | null;
        topic: string | null;
      }>;
      kind: 'materials';
      state: 'ready';
    } | {
      items: Array<{
        amountKopecks: number;
        createdAt: string;
        productName: string;
        purchaseRef: string;
        state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
      }>;
      kind: 'payments';
      /**
       * Whether payments were also searched by the person the text names: name_unavailable when names cannot be searched now, truncated when more people matched than the search takes and only the payments of some of them were searched, unavailable when the people directory did not answer; order number, bank payment number and amount are searched in every case
       */
      personSearch: 'available' | 'name_unavailable' | 'truncated' | 'unavailable';
      state: 'ready';
    }) | {
      kind: 'people' | 'products' | 'materials' | 'payments';
      state: 'unavailable';
    })>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/search',
      query: {
        'query': query,
      },
    });
  }
}
