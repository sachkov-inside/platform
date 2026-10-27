/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class AuthoringSearchService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Search the authoring groups the account may read, in a fixed order: at most five hits per group; a group whose dependency failed answers unavailable; an account that may read no group is refused
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
    }) | {
      kind: 'products' | 'materials';
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
