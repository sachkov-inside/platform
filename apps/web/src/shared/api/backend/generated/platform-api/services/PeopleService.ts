/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class PeopleService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List people for the owner, newest registration first: Accounts with a Sign-in Email, a verified Billing Contact or a current Telegram link, with their Products; search and filters narrow the list, the total counts every match, and the cursor keeps them
   * @returns any
   * @throws ApiError
   */
  public listPeople({
    limit,
    cursor,
    telegram,
    state,
    origin,
    productId,
    query,
  }: {
    /**
     * People per page, 25 by default
     */
    limit?: number,
    /**
     * Opaque `nextCursor` of the previous page; valid only with the same query and filters
     */
    cursor?: string,
    /**
     * Only people with a Telegram problem the Overview counts: community_failed, the latest community operation was rejected, failed or is overdue; delivery_failed, a Telegram delivery of the last 30 days failed or its result is unknown
     */
    telegram?: 'community_failed' | 'delivery_failed',
    /**
     * Only people with a Product Access in this state (of `productId` when given, otherwise of any Product)
     */
    state?: 'active' | 'revoked',
    /**
     * Only people with a Product Access first acquired this way (of `productId` when given, otherwise of any Product)
     */
    origin?: 'paid' | 'manual' | 'legacy' | 'course_activation' | 'unknown',
    /**
     * Only people with a Product Access to this Product
     */
    productId?: string,
    /**
     * Trimmed, 1–160 characters. A UUID is an Account ID, an address is matched exactly, other text is a Telegram name or @username
     */
    query?: string,
  }): CancelablePromise<{
    items: Array<{
      accountId: string;
      contactsState: 'complete' | 'partial';
      displayName: string | null;
      email: string | null;
      lastActivityAt: string | null;
      products: Array<{
        access: 'active' | 'revoked';
        name: string;
        origin: 'paid' | 'manual' | 'legacy' | 'course_activation' | 'unknown';
        productId: string;
      }>;
      registeredAt: string;
      telegram: 'linked' | 'not_linked';
      username: string | null;
    }>;
    /**
     * unavailable: the text was a name or @username and Telegram could not search it, so the empty list is no answer. truncated: more than 50 people matched the text; the items, the total and the cursor cover only the first 50 matches
     */
    nameSearch: 'available' | 'unavailable' | 'truncated';
    nextCursor: string | null;
    total: number;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/people',
      query: {
        'limit': limit,
        'cursor': cursor,
        'telegram': telegram,
        'state': state,
        'origin': origin,
        'productId': productId,
        'query': query,
      },
    });
  }
  /**
   * Read the person card for the owner: header, Products with their history, payments, learning, submissions, Telegram and waitlists; each block answers on its own and is unavailable when its owner fails, submissions also need materials:manage
   * @returns any
   * @throws ApiError
   */
  public readPerson({
    accountId,
  }: {
    accountId: string,
  }): CancelablePromise<{
    learning: ({
      items: Array<{
        name: string;
        productId: string;
        progress: ({
          lastActivityAt: string | null;
          read: number;
          state: 'measured';
          total: number;
        } | {
          state: 'unavailable';
        });
        startedAt: string | null;
      }>;
      state: 'ready';
    } | {
      state: 'unavailable';
    });
    payments: ({
      items: Array<{
        amountKopecks: number;
        createdAt: string;
        paymentId: string;
        paymentLinkId: string | null;
        productId: string | null;
        productName: string | null;
        state: string;
      }>;
      state: 'ready';
    } | {
      state: 'unavailable';
    });
    person: {
      accountId: string;
      contactsState: 'complete' | 'partial';
      displayName: string | null;
      email: string | null;
      registeredAt: string;
      telegramUrl: string | null;
      username: string | null;
    };
    products: ({
      items: Array<{
        access: 'active' | 'revoked';
        firstIssuedAt: string | null;
        history: Array<{
          actor: ({
            kind: 'system';
          } | {
            accountId: string;
            kind: 'person';
            label: string | null;
          } | {
            kind: 'unknown';
          });
          at: string;
          kind: 'purchase' | 'activation' | 'manual_issue' | 'transfer' | 'revoke' | 'restore' | 'migrate' | 'other';
          reason: string | null;
        }>;
        name: string;
        origin: 'paid' | 'manual' | 'legacy' | 'course_activation' | 'unknown';
        productId: string;
        revision: number;
      }>;
      state: 'ready';
    } | {
      state: 'unavailable';
    });
    submissions: ({
      items: Array<{
        count: number;
        lastSubmittedAt: string;
        lastTaskCode: string | null;
        productId: string;
      }>;
      state: 'ready';
    } | {
      state: 'forbidden';
    } | {
      state: 'unavailable';
    });
    telegram: ({
      link: 'linked' | 'not_linked';
      marketing: 'enabled' | 'stopped' | 'unknown';
      membership: 'member' | 'not_member' | 'unknown';
      observedAt: string | null;
      restriction: 'none' | 'moderation' | 'external_unknown' | 'unknown';
      state: 'ready';
    } | {
      state: 'unavailable';
    });
    waitlists: ({
      items: Array<{
        active: boolean;
        intakeName: string;
        joinedAt: string;
        productId: string;
        productName: string | null;
      }>;
      state: 'ready';
    } | {
      state: 'unavailable';
    });
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/people/{accountId}',
      path: {
        'accountId': accountId,
      },
    });
  }
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
   * List every Product, archived ones flagged, sorted by name, for the people list filter and the grant dialog; requires billing:manage
   * @returns any
   * @throws ApiError
   */
  public listPeopleProductChoices(): CancelablePromise<{
    items: Array<{
      archived: boolean;
      name: string;
      productId: string;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/authoring/people/product-choices',
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
    /**
     * unavailable: the text was a name or @username and Telegram could not search it, so the empty list is no answer. truncated: more people matched the text than `limit`; the items are only the first matches
     */
    nameSearch: 'available' | 'unavailable' | 'truncated';
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
