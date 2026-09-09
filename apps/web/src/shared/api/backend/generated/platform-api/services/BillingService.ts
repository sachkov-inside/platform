/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class BillingService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read own subscription, its paid term and pending changes
   * @returns any
   * @throws ApiError
   */
  public currentBilling(): CancelablePromise<{
    subscription: {
      inFlightPayment: {
        attemptRef: string;
        kind: 'initial' | 'renewal' | 'upgrade';
        state: string;
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
      kind: 'initial' | 'renewal' | 'upgrade';
      state: string;
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
      kind: 'initial' | 'renewal' | 'upgrade';
      state: string;
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
    } | null;
    subscription: {
      inFlightPayment: {
        attemptRef: string;
        kind: 'initial' | 'renewal' | 'upgrade';
        state: string;
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
      kind: 'initial' | 'renewal' | 'upgrade';
      state: string;
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
      kind: 'initial' | 'renewal' | 'upgrade';
      state: string;
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
