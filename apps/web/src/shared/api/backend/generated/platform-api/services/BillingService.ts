/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class BillingService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Start or recover one subscription purchase
   * @returns any
   * @throws ApiError
   */
  public purchaseBillingSubscription({
    requestBody,
  }: {
    requestBody: {
      acknowledgeExistingAccess: boolean;
      consentEvidenceRefs: Array<string>;
      contactRevision: number;
      operationId: string;
      quoteRef: string;
    },
  }): CancelablePromise<{
    access: 'awaiting_payment' | 'preparing' | 'ready';
    confirmedAt: string | null;
    fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
    paymentUrl: string | null;
    periodEndsAt: string | null;
    purchaseRef: string;
    snapshot: {
      currency: 'RUB';
      firstPriceKopecks: number;
      offer: {
        archived: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        id: string;
        name: string;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription';
        months: number;
        offerId: string;
        priceKopecks: number;
        revision: number;
      };
      promotion: {
        id: string;
        name: string;
        percent: number;
        revision: number;
      } | null;
      renewalPriceKopecks: number;
      timezone: 'Europe/Moscow';
    };
    state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/purchase',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read authoritative own payment and access status
   * @returns any
   * @throws ApiError
   */
  public readBillingPurchase({
    purchaseRef,
  }: {
    purchaseRef: string,
  }): CancelablePromise<{
    access: 'awaiting_payment' | 'preparing' | 'ready';
    confirmedAt: string | null;
    fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
    paymentUrl: string | null;
    periodEndsAt: string | null;
    purchaseRef: string;
    snapshot: {
      currency: 'RUB';
      firstPriceKopecks: number;
      offer: {
        archived: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        id: string;
        name: string;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription';
        months: number;
        offerId: string;
        priceKopecks: number;
        revision: number;
      };
      promotion: {
        id: string;
        name: string;
        percent: number;
        revision: number;
      } | null;
      renewalPriceKopecks: number;
      timezone: 'Europe/Moscow';
    };
    state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/billing/purchases/{purchaseRef}',
      path: {
        'purchaseRef': purchaseRef,
      },
    });
  }
  /**
   * Save a price quote for a new subscription
   * @returns any
   * @throws ApiError
   */
  public quoteBillingPurchase({
    requestBody,
  }: {
    requestBody: {
      operationId: string;
      optionRevision: number;
      paymentOptionId: string;
      promoCode?: string;
    },
  }): CancelablePromise<{
    createdAt: string;
    expiresAt: string;
    quoteRef: string;
    snapshot: {
      currency: 'RUB';
      firstPriceKopecks: number;
      offer: {
        archived: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        id: string;
        name: string;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription';
        months: number;
        offerId: string;
        priceKopecks: number;
        revision: number;
      };
      promotion: {
        id: string;
        name: string;
        percent: number;
        revision: number;
      } | null;
      renewalPriceKopecks: number;
      timezone: 'Europe/Moscow';
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/quote',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Manage offers, options and promotions
   * @returns any
   * @throws ApiError
   */
  public manageBilling({
    requestBody,
  }: {
    requestBody: ({
      expectedRevision?: number;
      operation: 'offers.save';
      operationId: string;
      value: {
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        id: string;
        name: string;
      };
    } | {
      expectedRevision: number;
      id: string;
      operation: 'offers.archive';
      operationId: string;
    } | {
      expectedRevision?: number;
      operation: 'paymentOptions.save';
      operationId: string;
      value: {
        id: string;
        mode?: 'subscription';
        months: number;
        offerId: string;
        priceKopecks: number;
      };
    } | {
      expectedRevision: number;
      id: string;
      operation: 'paymentOptions.archive';
      operationId: string;
    } | {
      expectedRevision?: number;
      operation: 'promotions.save';
      operationId: string;
      value: {
        code: string | null;
        endsAt: string;
        id: string;
        name: string;
        offerIds: Array<string>;
        paymentOptionIds: Array<string>;
        percent: number;
        startsAt: string;
        usageLimit: number | null;
      };
    } | {
      expectedRevision: number;
      id: string;
      operation: 'promotions.archive';
      operationId: string;
    }),
  }): CancelablePromise<{
    archived: boolean;
    id: string;
    revision: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/billing/admin',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read active options and public first-payment prices
   * @returns any
   * @throws ApiError
   */
  public billingOffers({
    limit = 50,
    cursor,
  }: {
    limit?: number,
    cursor?: string,
  }): CancelablePromise<{
    items: Array<{
      currency: 'RUB';
      firstPriceKopecks: number;
      offer: {
        archived: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        id: string;
        name: string;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription';
        months: number;
        offerId: string;
        priceKopecks: number;
        revision: number;
      };
      promotion: {
        id: string;
        name: string;
        percent: number;
        revision: number;
      } | null;
      renewalPriceKopecks: number;
      timezone: 'Europe/Moscow';
    }>;
    nextCursor: string | null;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/billing/offers',
      query: {
        'limit': limit,
        'cursor': cursor,
      },
    });
  }
  /**
   * Durably accept a signed bank notification
   * @returns string
   * @throws ApiError
   */
  public acceptTbankNotification({
    requestBody,
  }: {
    requestBody: Record<string, any>,
  }): CancelablePromise<'OK'> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/billing/tbank/notification',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
