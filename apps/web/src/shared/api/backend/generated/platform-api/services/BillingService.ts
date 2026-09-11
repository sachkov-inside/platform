/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class BillingService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read own subscription, its paid term, pending changes and service notices
   * @returns any
   * @throws ApiError
   */
  public currentBilling(): CancelablePromise<{
    grounds: Array<{
      active: boolean;
      capabilities: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
      source: 'paid' | 'manual' | 'legacy';
      startsAt: string;
      validUntil: string | null;
    }>;
    notices: Array<{
      amountKopecks: number | null;
      dueAt: string | null;
      kind: 'renewal_reminder' | 'payment_succeeded' | 'payment_failed' | 'renewal_cancelled' | 'access_expired' | 'refund_resolved';
      noticeRef: string;
      occurredAt: string;
      state: 'current' | 'superseded';
    }>;
    payments: Array<{
      amountKopecks: number;
      confirmedAt: string | null;
      createdAt: string;
      fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
      kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
      months: number;
      offerName: string;
      periodEndsAt: string | null;
      purchaseRef: string;
      state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
    }>;
    subscription: {
      inFlightPayment: {
        attemptRef: string;
        kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
        state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
      } | null;
      paidUntil: string;
      paymentMethod: {
        methodRef: string;
        revoked: boolean;
      } | null;
      pendingChange: {
        acceptedAt: string;
        changeQuoteRef: string;
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
            published?: boolean;
            revision: number;
          };
          paymentOption: {
            archived: boolean;
            id: string;
            mode?: 'subscription' | 'one_time';
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
      } | null;
      pendingMethodChange: {
        flowRef: string;
        formUrl: string | null;
      } | null;
      periodAmountKopecks: number;
      periodIndex: number;
      periodStartsAt: string;
      revision: number;
      snapshot: {
        currency: 'RUB';
        offer: {
          archived: boolean;
          benefitPeriods?: Array<{
            capability: ('materials' | 'community' | 'reviews' | 'support' | string);
            months: number | null;
          }>;
          benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
          id: string;
          name: string;
          published?: boolean;
          revision: number;
        };
        paymentOption: {
          archived: boolean;
          id: string;
          mode?: 'subscription' | 'one_time';
          months: number;
          offerId: string;
          priceKopecks: number;
          revision: number;
        };
        renewalPriceKopecks: number;
        timezone: 'Europe/Moscow';
      };
      state: 'active' | 'canceled' | 'ended';
      subscriptionRef: string;
    } | null;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/billing',
    });
  }
  /**
   * Start a proven bank binding session for a new payment method
   * @returns any
   * @throws ApiError
   */
  public changeBillingMethod({
    requestBody,
  }: {
    requestBody: {
      expectedRevision: number;
      operationId: string;
    },
  }): CancelablePromise<{
    flowRef: string;
    formUrl: string | null;
    methodRef: string | null;
    state: 'started' | 'completed' | 'rejected';
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/payment-method/change',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Forbid further use of the saved payment method
   * @returns any
   * @throws ApiError
   */
  public revokeBillingMethod({
    requestBody,
  }: {
    requestBody: {
      expectedRevision: number;
      operationId: string;
      paymentMethodRef: string;
    },
  }): CancelablePromise<{
    inFlightPayment: {
      attemptRef: string;
      kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
      state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
    } | null;
    paidUntil: string;
    paymentMethod: {
      methodRef: string;
      revoked: boolean;
    } | null;
    pendingChange: {
      acceptedAt: string;
      changeQuoteRef: string;
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
          published?: boolean;
          revision: number;
        };
        paymentOption: {
          archived: boolean;
          id: string;
          mode?: 'subscription' | 'one_time';
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
    } | null;
    pendingMethodChange: {
      flowRef: string;
      formUrl: string | null;
    } | null;
    periodAmountKopecks: number;
    periodIndex: number;
    periodStartsAt: string;
    revision: number;
    snapshot: {
      currency: 'RUB';
      offer: {
        archived: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        id: string;
        name: string;
        published?: boolean;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription' | 'one_time';
        months: number;
        offerId: string;
        priceKopecks: number;
        revision: number;
      };
      renewalPriceKopecks: number;
      timezone: 'Europe/Moscow';
    };
    state: 'active' | 'canceled' | 'ended';
    subscriptionRef: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/payment-method/revoke',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Start or recover one subscription or one-time purchase
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
        published?: boolean;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription' | 'one_time';
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
        published?: boolean;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription' | 'one_time';
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
        published?: boolean;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription' | 'one_time';
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
   * Stop future charges and keep the paid term
   * @returns any
   * @throws ApiError
   */
  public cancelBillingRenewal({
    requestBody,
  }: {
    requestBody: {
      expectedRevision: number;
      operationId: string;
    },
  }): CancelablePromise<{
    inFlightPayment: {
      attemptRef: string;
      kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
      state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
    } | null;
    paidUntil: string;
    paymentMethod: {
      methodRef: string;
      revoked: boolean;
    } | null;
    pendingChange: {
      acceptedAt: string;
      changeQuoteRef: string;
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
          published?: boolean;
          revision: number;
        };
        paymentOption: {
          archived: boolean;
          id: string;
          mode?: 'subscription' | 'one_time';
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
    } | null;
    pendingMethodChange: {
      flowRef: string;
      formUrl: string | null;
    } | null;
    periodAmountKopecks: number;
    periodIndex: number;
    periodStartsAt: string;
    revision: number;
    snapshot: {
      currency: 'RUB';
      offer: {
        archived: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        id: string;
        name: string;
        published?: boolean;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription' | 'one_time';
        months: number;
        offerId: string;
        priceKopecks: number;
        revision: number;
      };
      renewalPriceKopecks: number;
      timezone: 'Europe/Moscow';
    };
    state: 'active' | 'canceled' | 'ended';
    subscriptionRef: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/subscription/cancel',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Accept a calculated option change
   * @returns any
   * @throws ApiError
   */
  public changeBillingOption({
    requestBody,
  }: {
    requestBody: {
      changeQuoteRef: string;
      expectedRevision: number;
      operationId: string;
    },
  }): CancelablePromise<{
    payment: {
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
          published?: boolean;
          revision: number;
        };
        paymentOption: {
          archived: boolean;
          id: string;
          mode?: 'subscription' | 'one_time';
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
    } | null;
    subscription: {
      inFlightPayment: {
        attemptRef: string;
        kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
        state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
      } | null;
      paidUntil: string;
      paymentMethod: {
        methodRef: string;
        revoked: boolean;
      } | null;
      pendingChange: {
        acceptedAt: string;
        changeQuoteRef: string;
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
            published?: boolean;
            revision: number;
          };
          paymentOption: {
            archived: boolean;
            id: string;
            mode?: 'subscription' | 'one_time';
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
      } | null;
      pendingMethodChange: {
        flowRef: string;
        formUrl: string | null;
      } | null;
      periodAmountKopecks: number;
      periodIndex: number;
      periodStartsAt: string;
      revision: number;
      snapshot: {
        currency: 'RUB';
        offer: {
          archived: boolean;
          benefitPeriods?: Array<{
            capability: ('materials' | 'community' | 'reviews' | 'support' | string);
            months: number | null;
          }>;
          benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
          id: string;
          name: string;
          published?: boolean;
          revision: number;
        };
        paymentOption: {
          archived: boolean;
          id: string;
          mode?: 'subscription' | 'one_time';
          months: number;
          offerId: string;
          priceKopecks: number;
          revision: number;
        };
        renewalPriceKopecks: number;
        timezone: 'Europe/Moscow';
      };
      state: 'active' | 'canceled' | 'ended';
      subscriptionRef: string;
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/subscription/change',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Drop a scheduled option change before its attempt is sent
   * @returns any
   * @throws ApiError
   */
  public cancelBillingChange({
    requestBody,
  }: {
    requestBody: {
      expectedRevision: number;
      operationId: string;
    },
  }): CancelablePromise<{
    inFlightPayment: {
      attemptRef: string;
      kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
      state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
    } | null;
    paidUntil: string;
    paymentMethod: {
      methodRef: string;
      revoked: boolean;
    } | null;
    pendingChange: {
      acceptedAt: string;
      changeQuoteRef: string;
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
          published?: boolean;
          revision: number;
        };
        paymentOption: {
          archived: boolean;
          id: string;
          mode?: 'subscription' | 'one_time';
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
    } | null;
    pendingMethodChange: {
      flowRef: string;
      formUrl: string | null;
    } | null;
    periodAmountKopecks: number;
    periodIndex: number;
    periodStartsAt: string;
    revision: number;
    snapshot: {
      currency: 'RUB';
      offer: {
        archived: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        id: string;
        name: string;
        published?: boolean;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription' | 'one_time';
        months: number;
        offerId: string;
        priceKopecks: number;
        revision: number;
      };
      renewalPriceKopecks: number;
      timezone: 'Europe/Moscow';
    };
    state: 'active' | 'canceled' | 'ended';
    subscriptionRef: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/subscription/change/cancel',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Calculate an upgrade top-up or the next period conditions
   * @returns any
   * @throws ApiError
   */
  public quoteBillingChange({
    requestBody,
  }: {
    requestBody: {
      expectedRevision: number;
      operationId: string;
      paymentOptionId: string;
    },
  }): CancelablePromise<{
    baseRevision: number;
    changeQuoteRef: string;
    expiresAt: string;
    plan: ({
      effectiveAt: string;
      kind: 'upgrade';
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
          published?: boolean;
          revision: number;
        };
        paymentOption: {
          archived: boolean;
          id: string;
          mode?: 'subscription' | 'one_time';
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
      topUpKopecks: number;
    } | {
      effectiveAt: string;
      kind: 'scheduled';
      nextPriceKopecks: number;
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
          published?: boolean;
          revision: number;
        };
        paymentOption: {
          archived: boolean;
          id: string;
          mode?: 'subscription' | 'one_time';
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
    });
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/subscription/change/quote',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Resume renewal inside the active paid term on its original conditions
   * @returns any
   * @throws ApiError
   */
  public resumeBillingRenewal({
    requestBody,
  }: {
    requestBody: {
      consentEvidenceRefs: Array<string>;
      expectedRevision: number;
      operationId: string;
    },
  }): CancelablePromise<{
    inFlightPayment: {
      attemptRef: string;
      kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
      state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
    } | null;
    paidUntil: string;
    paymentMethod: {
      methodRef: string;
      revoked: boolean;
    } | null;
    pendingChange: {
      acceptedAt: string;
      changeQuoteRef: string;
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
          published?: boolean;
          revision: number;
        };
        paymentOption: {
          archived: boolean;
          id: string;
          mode?: 'subscription' | 'one_time';
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
    } | null;
    pendingMethodChange: {
      flowRef: string;
      formUrl: string | null;
    } | null;
    periodAmountKopecks: number;
    periodIndex: number;
    periodStartsAt: string;
    revision: number;
    snapshot: {
      currency: 'RUB';
      offer: {
        archived: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        id: string;
        name: string;
        published?: boolean;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription' | 'one_time';
        months: number;
        offerId: string;
        priceKopecks: number;
        revision: number;
      };
      renewalPriceKopecks: number;
      timezone: 'Europe/Moscow';
    };
    state: 'active' | 'canceled' | 'ended';
    subscriptionRef: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/subscription/resume',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Manage offers, payments, refund decisions and manual access with the owner billing permission
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
      expectedRevision: number;
      id: string;
      operation: 'offers.publish';
      operationId: string;
    } | {
      expectedRevision: number;
      id: string;
      operation: 'offers.unpublish';
      operationId: string;
    } | {
      expectedRevision?: number;
      operation: 'paymentOptions.save';
      operationId: string;
      value: {
        id: string;
        mode?: 'subscription' | 'one_time';
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
    } | {
      cursor?: string;
      limit: number;
      operation: 'offers.list';
      operationId: string;
    } | {
      accountId?: string;
      cursor?: string;
      kind?: 'initial' | 'one_time' | 'renewal' | 'upgrade';
      limit: number;
      operation: 'payments.list';
      operationId: string;
      state?: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
    } | {
      operation: 'payments.read';
      operationId: string;
      purchaseRef: string;
    } | {
      operation: 'payments.reconcile';
      operationId: string;
      purchaseRef: string;
    } | {
      accountId: string;
      expectedRevision: number;
      operation: 'subscriptions.cancel';
      operationId: string;
      reason: string;
    } | {
      access: 'keep' | 'revoke';
      amountKopecks: number;
      operation: 'refunds.decide';
      operationId: string;
      purchaseRef: string;
      reason: string;
      recurring: 'keep' | 'cancel';
    } | {
      decisionRef: string;
      expectedRevision: number;
      operation: 'refunds.execute';
      operationId: string;
    } | {
      operation: 'refunds.read';
      operationId: string;
      purchaseRef: string;
    } | {
      accountId: string;
      operation: 'grants.read';
      operationId: string;
    } | {
      operation: 'grants.previewBatch';
      operationId: string;
      rows: Array<{
        accountId: string;
        rowKey: string;
        source: 'manual' | 'legacy';
        sourceRef: string;
        terms: {
          capabilities: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
          reason: string;
          startsAt: any;
          validUntil: any;
        };
      }>;
    } | {
      confirmedRows: any;
      expectedRevision: number;
      operation: 'grants.applyBatch';
      operationId: string;
      previewRef: string;
    } | {
      expectedRevision: number;
      grantRef: string;
      operation: 'grants.extend';
      operationId: string;
      reason: string;
      validUntil: any;
    } | {
      expectedRevision: number;
      grantRef: string;
      operation: 'grants.revoke';
      operationId: string;
      reason: string;
    }),
  }): CancelablePromise<{
    operationRef: string;
    result: ({
      outcome: 'catalog';
      value: {
        archived: boolean;
        id: string;
        published?: boolean;
        revision: number;
      };
    } | {
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
          published?: boolean;
          revision: number;
        };
        paymentOption: {
          archived: boolean;
          id: string;
          mode?: 'subscription' | 'one_time';
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
      outcome: 'catalogOffers';
    } | {
      items: Array<{
        access: 'awaiting_payment' | 'preparing' | 'ready';
        accountId: string;
        amountKopecks: number;
        confirmedAt: string | null;
        createdAt: string;
        environment: 'demo' | 'production';
        fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
        kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
        paymentId: string | null;
        periodEndsAt: string | null;
        periodIndex: number | null;
        purchaseRef: string;
        refundableKopecks: number;
        refundedKopecks: number;
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
            published?: boolean;
            revision: number;
          };
          paymentOption: {
            archived: boolean;
            id: string;
            mode?: 'subscription' | 'one_time';
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
        subscriptionRef: string | null;
        terminalRef: string;
        updatedAt: string;
      }>;
      nextCursor: string | null;
      outcome: 'payments';
    } | {
      audit: Array<{
        actorId: string;
        createdAt: string;
        operation: string;
        operationId: string;
        reason: string;
      }>;
      decisions: Array<{
        access: 'keep' | 'revoke';
        accountId: string;
        actorId: string;
        amountKopecks: number;
        attempt: {
          amountKopecks: number;
          errorCode: string | null;
          observedStatus: string | null;
          refundRef: string;
          state: 'sent' | 'unknown' | 'confirmed' | 'failed';
          updatedAt: string;
        } | null;
        createdAt: string;
        decisionRef: string;
        purchaseRef: string;
        reason: string;
        recurring: 'keep' | 'cancel';
        revision: number;
        state: 'decided' | 'executing' | 'executed' | 'failed';
        updatedAt: string;
      }>;
      events: Array<{
        kind: string;
        occurredAt: string;
        recordedAt: string;
      }>;
      outcome: 'payment';
      value: {
        access: 'awaiting_payment' | 'preparing' | 'ready';
        accountId: string;
        amountKopecks: number;
        confirmedAt: string | null;
        createdAt: string;
        environment: 'demo' | 'production';
        fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
        kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
        paymentId: string | null;
        periodEndsAt: string | null;
        periodIndex: number | null;
        purchaseRef: string;
        refundableKopecks: number;
        refundedKopecks: number;
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
            published?: boolean;
            revision: number;
          };
          paymentOption: {
            archived: boolean;
            id: string;
            mode?: 'subscription' | 'one_time';
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
        subscriptionRef: string | null;
        terminalRef: string;
        updatedAt: string;
      };
    } | {
      outcome: 'reconciled';
      value: {
        access: 'awaiting_payment' | 'preparing' | 'ready';
        accountId: string;
        amountKopecks: number;
        confirmedAt: string | null;
        createdAt: string;
        environment: 'demo' | 'production';
        fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
        kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
        paymentId: string | null;
        periodEndsAt: string | null;
        periodIndex: number | null;
        purchaseRef: string;
        refundableKopecks: number;
        refundedKopecks: number;
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
            published?: boolean;
            revision: number;
          };
          paymentOption: {
            archived: boolean;
            id: string;
            mode?: 'subscription' | 'one_time';
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
        subscriptionRef: string | null;
        terminalRef: string;
        updatedAt: string;
      };
    } | {
      outcome: 'subscription';
      value: {
        inFlightPayment: {
          attemptRef: string;
          kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
          state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
        } | null;
        paidUntil: string;
        paymentMethod: {
          methodRef: string;
          revoked: boolean;
        } | null;
        pendingChange: {
          acceptedAt: string;
          changeQuoteRef: string;
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
              published?: boolean;
              revision: number;
            };
            paymentOption: {
              archived: boolean;
              id: string;
              mode?: 'subscription' | 'one_time';
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
        } | null;
        pendingMethodChange: {
          flowRef: string;
          formUrl: string | null;
        } | null;
        periodAmountKopecks: number;
        periodIndex: number;
        periodStartsAt: string;
        revision: number;
        snapshot: {
          currency: 'RUB';
          offer: {
            archived: boolean;
            benefitPeriods?: Array<{
              capability: ('materials' | 'community' | 'reviews' | 'support' | string);
              months: number | null;
            }>;
            benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
            id: string;
            name: string;
            published?: boolean;
            revision: number;
          };
          paymentOption: {
            archived: boolean;
            id: string;
            mode?: 'subscription' | 'one_time';
            months: number;
            offerId: string;
            priceKopecks: number;
            revision: number;
          };
          renewalPriceKopecks: number;
          timezone: 'Europe/Moscow';
        };
        state: 'active' | 'canceled' | 'ended';
        subscriptionRef: string;
      };
    } | {
      outcome: 'refundDecision';
      value: {
        access: 'keep' | 'revoke';
        accountId: string;
        actorId: string;
        amountKopecks: number;
        attempt: {
          amountKopecks: number;
          errorCode: string | null;
          observedStatus: string | null;
          refundRef: string;
          state: 'sent' | 'unknown' | 'confirmed' | 'failed';
          updatedAt: string;
        } | null;
        createdAt: string;
        decisionRef: string;
        purchaseRef: string;
        reason: string;
        recurring: 'keep' | 'cancel';
        revision: number;
        state: 'decided' | 'executing' | 'executed' | 'failed';
        updatedAt: string;
      };
    } | {
      decisions: Array<{
        access: 'keep' | 'revoke';
        accountId: string;
        actorId: string;
        amountKopecks: number;
        attempt: {
          amountKopecks: number;
          errorCode: string | null;
          observedStatus: string | null;
          refundRef: string;
          state: 'sent' | 'unknown' | 'confirmed' | 'failed';
          updatedAt: string;
        } | null;
        createdAt: string;
        decisionRef: string;
        purchaseRef: string;
        reason: string;
        recurring: 'keep' | 'cancel';
        revision: number;
        state: 'decided' | 'executing' | 'executed' | 'failed';
        updatedAt: string;
      }>;
      outcome: 'refunds';
      purchaseRef: string;
      refundableKopecks: number;
      refundedKopecks: number;
    } | {
      outcome: 'grants';
      value: {
        accountId: string;
        grants: Array<{
          accountId: string;
          active: boolean;
          capabilities: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
          grantRef: string;
          reason: string;
          revision: number;
          revokedAt: string | null;
          source: 'paid' | 'manual' | 'legacy';
          sourceRef: string;
          startsAt: string;
          validUntil: string | null;
        }>;
        history: Array<{
          actorId: string | null;
          grantRef: string | null;
          kind: string;
          operationId: string;
          reason: string;
          recordedAt: string;
          revision: number;
        }>;
      };
    } | {
      expiresAt: string;
      outcome: 'grantPreview';
      previewRef: string;
      revision: number;
      rows: Array<{
        accountId: string;
        rowKey: string;
        status: 'confirmed' | 'not_found';
      }>;
    } | {
      outcome: 'grantBatch';
      rows: Array<{
        result: ({
          grantRef: string;
          ok: boolean;
          revision: number;
        } | {
          error: {
            code: 'operation_conflict';
          };
          ok: boolean;
        });
        rowKey: string;
      }>;
    } | {
      grantRef: string;
      outcome: 'grant';
      revision: number;
    });
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/billing/admin',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read active options and public first-payment prices, filtered by sale mode and access capability
   * @returns any
   * @throws ApiError
   */
  public billingOffers({
    capability,
    mode,
    limit = 50,
    cursor,
  }: {
    capability?: ('materials' | 'community' | 'reviews' | 'support' | string),
    mode?: 'subscription' | 'one_time',
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
        published?: boolean;
        revision: number;
      };
      paymentOption: {
        archived: boolean;
        id: string;
        mode?: 'subscription' | 'one_time';
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
        'capability': capability,
        'mode': mode,
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
