/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class BillingService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read own lifetime Products, purchase history and service notices
   * @returns any
   * @throws ApiError
   */
  public readOwnBilling(): CancelablePromise<{
    access: {
      grounds: Array<{
        active: boolean;
        capabilities: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        content?: Array<{
          available: boolean;
          id: string;
          kind: 'product' | 'material';
          slug: string | null;
          title: string;
        }>;
        source: 'paid' | 'manual' | 'legacy' | 'course_activation' | 'unknown';
        startsAt: string | null;
        validUntil: string | null;
      }>;
    };
    notices: Array<{
      amountKopecks: number | null;
      dueAt: string | null;
      kind: 'renewal_reminder' | 'payment_succeeded' | 'payment_failed' | 'renewal_cancelled' | 'access_expired' | 'refund_resolved';
      noticeRef: string;
      occurredAt: string;
      state: 'current' | 'superseded';
    }>;
    payments: Array<{
      access?: 'awaiting_payment' | 'preparing' | 'review_required' | 'ready' | 'unavailable';
      amountKopecks: number;
      confirmedAt: string | null;
      content?: Array<{
        available: boolean;
        id: string;
        kind: 'product' | 'material';
        slug: string | null;
        title: string;
      }>;
      createdAt: string;
      fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
      kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
      months: number;
      offerName: string;
      periodEndsAt: string | null;
      productAccess?: Array<{
        access: 'awaiting_payment' | 'preparing' | 'review_required' | 'ready' | 'unavailable';
        productId: string;
      }>;
      purchaseRef: string;
      refundedAt: string | null;
      refundedKopecks: number | null;
      snapshot?: {
        communityPolicy?: 'explicit';
        currency: 'RUB';
        firstPriceKopecks: number;
        individualPayment?: {
          basePriceKopecks: number;
          linkId: string;
        };
        offer: {
          archived: boolean;
          availableForAssignment?: boolean;
          benefitPeriods?: Array<{
            capability: ('materials' | 'community' | 'reviews' | 'support' | string);
            months: number | null;
          }>;
          benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
          coverage?: {
            materialIds: Array<string>;
            productIds: Array<string>;
            wholePlatform?: boolean;
          } | null;
          eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
        product?: {
          id: string;
          name: string;
          priceRevision: number;
        };
        promotion: {
          id: string;
          name: string;
          percent: number;
          revision: number;
        } | null;
        renewalPriceKopecks: number;
        supportMonths?: 3;
        timezone: 'Europe/Moscow';
      };
      state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
    }>;
    products: Array<{
      community: {
        state: 'available' | 'expired' | 'revoked' | 'unavailable';
      };
      id: string;
      materials: {
        state: 'available' | 'expired' | 'revoked' | 'unavailable';
      };
      name: string;
      slug: string | null;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/billing',
    });
  }
  /**
   * Restore the latest own Product purchase
   * @returns any
   * @throws ApiError
   */
  public restoreProductPurchase({
    productId,
    purchaseRef,
  }: {
    productId: string,
    purchaseRef?: string,
  }): CancelablePromise<{
    access: 'awaiting_payment' | 'preparing' | 'review_required' | 'ready' | 'unavailable';
    confirmedAt: string | null;
    fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
    paymentUrl: string | null;
    periodEndsAt: string | null;
    purchaseRef: string;
    refundedKopecks?: number | null;
    retirementReason: 'sale_closed' | 'price_unavailable' | 'already_owned' | 'unsupported_attempt' | 'form_address_lost' | null;
    snapshot: {
      communityPolicy?: 'explicit';
      currency: 'RUB';
      firstPriceKopecks: number;
      individualPayment?: {
        basePriceKopecks: number;
        linkId: string;
      };
      offer: {
        archived: boolean;
        availableForAssignment?: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        coverage?: {
          materialIds: Array<string>;
          productIds: Array<string>;
          wholePlatform?: boolean;
        } | null;
        eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
      product?: {
        id: string;
        name: string;
        priceRevision: number;
      };
      promotion: {
        id: string;
        name: string;
        percent: number;
        revision: number;
      } | null;
      renewalPriceKopecks: number;
      supportMonths?: 3;
      timezone: 'Europe/Moscow';
    };
    state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
  } | null> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/billing/products/{productId}/purchase',
      path: {
        'productId': productId,
      },
      query: {
        'purchaseRef': purchaseRef,
      },
      errors: {
        403: `The terms of use in force are not accepted yet`,
        500: `Terms acceptance could not be checked`,
      },
    });
  }
  /**
   * Start or recover one Product purchase
   * @returns any
   * @throws ApiError
   */
  public purchaseProduct({
    requestBody,
  }: {
    requestBody: {
      acknowledgeExistingAccess?: boolean;
      consentEvidenceRefs: Array<string>;
      contactRevision?: number;
      email?: string;
      operationId: string;
      quoteRef: string;
    },
  }): CancelablePromise<{
    access: 'awaiting_payment' | 'preparing' | 'review_required' | 'ready' | 'unavailable';
    confirmedAt: string | null;
    fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
    paymentUrl: string | null;
    periodEndsAt: string | null;
    purchaseRef: string;
    refundedKopecks?: number | null;
    retirementReason: 'sale_closed' | 'price_unavailable' | 'already_owned' | 'unsupported_attempt' | 'form_address_lost' | null;
    snapshot: {
      communityPolicy?: 'explicit';
      currency: 'RUB';
      firstPriceKopecks: number;
      individualPayment?: {
        basePriceKopecks: number;
        linkId: string;
      };
      offer: {
        archived: boolean;
        availableForAssignment?: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        coverage?: {
          materialIds: Array<string>;
          productIds: Array<string>;
          wholePlatform?: boolean;
        } | null;
        eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
      product?: {
        id: string;
        name: string;
        priceRevision: number;
      };
      promotion: {
        id: string;
        name: string;
        percent: number;
        revision: number;
      } | null;
      renewalPriceKopecks: number;
      supportMonths?: 3;
      timezone: 'Europe/Moscow';
    };
    state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/purchase',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        403: `The terms of use in force are not accepted yet`,
        500: `Terms acceptance could not be checked`,
      },
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
    access: 'awaiting_payment' | 'preparing' | 'review_required' | 'ready' | 'unavailable';
    confirmedAt: string | null;
    fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
    paymentUrl: string | null;
    periodEndsAt: string | null;
    purchaseRef: string;
    refundedKopecks?: number | null;
    retirementReason: 'sale_closed' | 'price_unavailable' | 'already_owned' | 'unsupported_attempt' | 'form_address_lost' | null;
    snapshot: {
      communityPolicy?: 'explicit';
      currency: 'RUB';
      firstPriceKopecks: number;
      individualPayment?: {
        basePriceKopecks: number;
        linkId: string;
      };
      offer: {
        archived: boolean;
        availableForAssignment?: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        coverage?: {
          materialIds: Array<string>;
          productIds: Array<string>;
          wholePlatform?: boolean;
        } | null;
        eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
      product?: {
        id: string;
        name: string;
        priceRevision: number;
      };
      promotion: {
        id: string;
        name: string;
        percent: number;
        revision: number;
      } | null;
      renewalPriceKopecks: number;
      supportMonths?: 3;
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
      errors: {
        403: `The terms of use in force are not accepted yet`,
        500: `Terms acceptance could not be checked`,
      },
    });
  }
  /**
   * Save the Product price and best applicable discount
   * @returns any
   * @throws ApiError
   */
  public quoteBillingPurchase({
    requestBody,
  }: {
    requestBody: {
      operationId: string;
      paymentLinkId?: string;
      priceRevision: number;
      productId: string;
      promoCode?: string;
    },
  }): CancelablePromise<{
    createdAt: string;
    expiresAt: string;
    quoteRef: string;
    snapshot: {
      communityPolicy?: 'explicit';
      currency: 'RUB';
      firstPriceKopecks: number;
      individualPayment?: {
        basePriceKopecks: number;
        linkId: string;
      };
      offer: {
        archived: boolean;
        availableForAssignment?: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        coverage?: {
          materialIds: Array<string>;
          productIds: Array<string>;
          wholePlatform?: boolean;
        } | null;
        eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
      product?: {
        id: string;
        name: string;
        priceRevision: number;
      };
      promotion: {
        id: string;
        name: string;
        percent: number;
        revision: number;
      } | null;
      renewalPriceKopecks: number;
      supportMonths?: 3;
      timezone: 'Europe/Moscow';
    };
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/billing/quote',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        403: `The terms of use in force are not accepted yet`,
        500: `Terms acceptance could not be checked`,
      },
    });
  }
  /**
   * Manage offers, payments, refund history and manual access; refund initiation is unavailable
   * @returns any
   * @throws ApiError
   */
  public manageBilling({
    requestBody,
  }: {
    requestBody: ({
      expiresAt: string | null;
      operation: 'paymentLinks.create';
      operationId: string;
      price: ({
        amountKopecks: number;
        kind: 'amount';
      } | {
        kind: 'discount';
        percent: number;
      });
      priceRevision: number;
      productId: string;
    } | {
      expectedRevision: number;
      id: string;
      operation: 'paymentLinks.revoke';
      operationId: string;
    } | {
      cursor?: string;
      limit: number;
      operation: 'paymentLinks.list';
      operationId: string;
      productId?: string;
      state?: 'active' | 'pending' | 'unknown' | 'paid' | 'revoked' | 'expired' | 'changed';
    } | {
      identityRef: string;
      operation: 'recipients.lookup';
      operationId: string;
    } | {
      expectedRevision?: number;
      operation: 'productPrices.save';
      operationId: string;
      value: {
        name: string;
        priceKopecks: number;
        productId: string;
        published: boolean;
      };
    } | {
      expectedRevision: number;
      id: string;
      operation: 'productPrices.archive';
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
        percent: number;
        productIds: Array<string>;
        startsAt: string;
        usageLimit: number | null;
      };
    } | {
      expectedRevision: number;
      id: string;
      operation: 'promotions.archive';
      operationId: string;
    } | {
      expectedRevision?: number;
      operation: 'cohorts.save';
      operationId: string;
      value: {
        name: string;
        nextEvent: string;
        priceAfterStartKopecks: number | null;
        productId: string;
        stage: 'announcement' | 'preorder' | 'running' | 'between';
        startsOn: string | null;
      };
    } | {
      expectedRevision?: number;
      operation: 'productSalesState.save';
      operationId: string;
      value: {
        name: string;
        nextEvent: string;
        priceAfterStartKopecks: number | null;
        productId: string;
        stage: 'announcement' | 'preorder' | 'running' | 'between';
        startsOn: string | null;
      };
    } | {
      cursor?: string;
      limit: number;
      operation: 'productPrices.list';
      operationId: string;
      productId?: string;
    } | {
      archived: boolean;
      cursor?: string;
      limit: number;
      operation: 'promotions.list';
      operationId: string;
      productId?: string;
      questionnaire: boolean;
    } | {
      operation: 'content.list';
      operationId: string;
    } | {
      expectedRevision?: number;
      operation: 'activationRules.save';
      operationId: string;
      reason: string;
      value: {
        code: string;
        endsAt: any;
        id: string;
        name: string;
        productId: string;
        published: boolean;
        sourceRef: string;
        startsAt: any;
        verificationMode?: 'course_membership';
      };
    } | {
      operation: 'activationRules.list';
      operationId: string;
    } | {
      accountId?: string;
      cursor?: string;
      events?: 'review';
      from?: string;
      fulfillment?: 'incomplete';
      kind?: 'initial' | 'one_time' | 'renewal' | 'upgrade';
      limit: number;
      operation: 'payments.list';
      operationId: string;
      productId?: string;
      state?: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
      states?: Array<'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed'>;
      to?: string;
    } | {
      auditCursor?: {
        afterSequence: string;
        purchaseRef: string;
      };
      operation: 'payments.read';
      operationId: string;
      purchaseRef: string;
    } | {
      operation: 'payments.reconcile';
      operationId: string;
      purchaseRef: string;
    } | {
      operation: 'refunds.read';
      operationId: string;
      purchaseRef: string;
    } | {
      list: string;
      operation: 'respondents.import';
      operationId: string;
    } | {
      operation: 'respondents.issue';
      operationId: string;
      templatePromotionId: string;
      username: string;
    } | {
      operation: 'respondents.status';
      operationId: string;
    }),
  }): CancelablePromise<{
    operationRef: string;
    result: ({
      outcome: 'paymentLink';
      value: {
        createdAt: string;
        expiresAt: string | null;
        id: string;
        revision: number;
        snapshot: {
          communityPolicy?: 'explicit';
          currency: 'RUB';
          firstPriceKopecks: number;
          individualPayment?: {
            basePriceKopecks: number;
            linkId: string;
          };
          offer: {
            archived: boolean;
            availableForAssignment?: boolean;
            benefitPeriods?: Array<{
              capability: ('materials' | 'community' | 'reviews' | 'support' | string);
              months: number | null;
            }>;
            benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
            coverage?: {
              materialIds: Array<string>;
              productIds: Array<string>;
              wholePlatform?: boolean;
            } | null;
            eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
          product?: {
            id: string;
            name: string;
            priceRevision: number;
          };
          promotion: {
            id: string;
            name: string;
            percent: number;
            revision: number;
          } | null;
          renewalPriceKopecks: number;
          supportMonths?: 3;
          timezone: 'Europe/Moscow';
        };
        state: 'active' | 'pending' | 'unknown' | 'paid' | 'revoked' | 'expired' | 'changed';
      };
    } | {
      items: Array<{
        createdAt: string;
        expiresAt: string | null;
        id: string;
        revision: number;
        snapshot: {
          communityPolicy?: 'explicit';
          currency: 'RUB';
          firstPriceKopecks: number;
          individualPayment?: {
            basePriceKopecks: number;
            linkId: string;
          };
          offer: {
            archived: boolean;
            availableForAssignment?: boolean;
            benefitPeriods?: Array<{
              capability: ('materials' | 'community' | 'reviews' | 'support' | string);
              months: number | null;
            }>;
            benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
            coverage?: {
              materialIds: Array<string>;
              productIds: Array<string>;
              wholePlatform?: boolean;
            } | null;
            eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
          product?: {
            id: string;
            name: string;
            priceRevision: number;
          };
          promotion: {
            id: string;
            name: string;
            percent: number;
            revision: number;
          } | null;
          renewalPriceKopecks: number;
          supportMonths?: 3;
          timezone: 'Europe/Moscow';
        };
        state: 'active' | 'pending' | 'unknown' | 'paid' | 'revoked' | 'expired' | 'changed';
      }>;
      nextCursor: string | null;
      outcome: 'paymentLinks';
    } | {
      outcome: 'activationRule';
      value: {
        code: string;
        endsAt: any;
        id: string;
        name: string;
        productId: string;
        published: boolean;
        revision: number;
        sourceRef: string;
        startsAt: any;
        verificationMode?: 'course_membership';
      };
    } | {
      items: Array<{
        code: string;
        endsAt: any;
        id: string;
        name: string;
        productId: string;
        published: boolean;
        revision: number;
        sourceRef: string;
        startsAt: any;
        verificationMode?: 'course_membership';
      }>;
      outcome: 'activationRules';
    } | {
      items: Array<{
        available: boolean;
        id: string;
        kind: 'product' | 'material';
        slug: string | null;
        title: string;
      }>;
      outcome: 'content';
    } | {
      outcome: 'recipient';
      value: ({
        recipient: {
          accountId: string;
          accountRef: string;
          identityRef: string;
          linkRef: string;
          linkRevision: number;
        };
        state: 'found';
      } | {
        state: 'not_found';
      } | {
        state: 'ambiguous';
      });
    } | {
      outcome: 'catalog';
      value: {
        archived: boolean;
        id: string;
        published?: boolean;
        revision: number;
      };
    } | {
      archivedProductIds: Array<string>;
      items: Array<{
        communityPolicy?: 'explicit';
        currency: 'RUB';
        firstPriceKopecks: number;
        individualPayment?: {
          basePriceKopecks: number;
          linkId: string;
        };
        offer: {
          archived: boolean;
          availableForAssignment?: boolean;
          benefitPeriods?: Array<{
            capability: ('materials' | 'community' | 'reviews' | 'support' | string);
            months: number | null;
          }>;
          benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
          coverage?: {
            materialIds: Array<string>;
            productIds: Array<string>;
            wholePlatform?: boolean;
          } | null;
          eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
        product?: {
          id: string;
          name: string;
          priceRevision: number;
        };
        promotion: {
          id: string;
          name: string;
          percent: number;
          revision: number;
        } | null;
        renewalPriceKopecks: number;
        supportMonths?: 3;
        timezone: 'Europe/Moscow';
      }>;
      nextCursor: string | null;
      outcome: 'catalogOffers';
    } | {
      items: Array<{
        archived: boolean;
        code: string | null;
        endsAt: string;
        id: string;
        legacy: boolean;
        name: string;
        percent: number;
        productIds: Array<string>;
        questionnaire: boolean;
        revision: number;
        startsAt: string;
        usageLimit: number | null;
        usedCount: number;
      }>;
      nextCursor: string | null;
      outcome: 'promotions';
    } | {
      items: Array<{
        access: 'awaiting_payment' | 'preparing' | 'review_required' | 'ready';
        accountId: string;
        amountKopecks: number;
        confirmedAt: string | null;
        createdAt: string;
        environment: 'demo' | 'production' | 'local';
        fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
        kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
        paymentId: string | null;
        periodEndsAt: string | null;
        periodIndex: number | null;
        purchaseRef: string;
        refundableKopecks: number | null;
        refundedKopecks: number | null;
        snapshot: {
          communityPolicy?: 'explicit';
          currency: 'RUB';
          firstPriceKopecks: number;
          individualPayment?: {
            basePriceKopecks: number;
            linkId: string;
          };
          offer: {
            archived: boolean;
            availableForAssignment?: boolean;
            benefitPeriods?: Array<{
              capability: ('materials' | 'community' | 'reviews' | 'support' | string);
              months: number | null;
            }>;
            benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
            coverage?: {
              materialIds: Array<string>;
              productIds: Array<string>;
              wholePlatform?: boolean;
            } | null;
            eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
          product?: {
            id: string;
            name: string;
            priceRevision: number;
          };
          promotion: {
            id: string;
            name: string;
            percent: number;
            revision: number;
          } | null;
          renewalPriceKopecks: number;
          supportMonths?: 3;
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
        actorId: string | null;
        amountKopecks: number;
        attempt: {
          amountKopecks: number;
          errorCode: string | null;
          observedStatus: string | null;
          refundRef: string;
          state: 'sent' | 'unknown' | 'confirmed' | 'failed';
          updatedAt: string;
        } | null;
        basis: 'withdrawal' | 'compensation' | null;
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
      nextAuditCursor: {
        afterSequence: string;
        purchaseRef: string;
      } | null;
      outcome: 'payment';
      value: {
        access: 'awaiting_payment' | 'preparing' | 'review_required' | 'ready';
        accountId: string;
        amountKopecks: number;
        confirmedAt: string | null;
        createdAt: string;
        environment: 'demo' | 'production' | 'local';
        fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
        kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
        paymentId: string | null;
        periodEndsAt: string | null;
        periodIndex: number | null;
        purchaseRef: string;
        refundableKopecks: number | null;
        refundedKopecks: number | null;
        snapshot: {
          communityPolicy?: 'explicit';
          currency: 'RUB';
          firstPriceKopecks: number;
          individualPayment?: {
            basePriceKopecks: number;
            linkId: string;
          };
          offer: {
            archived: boolean;
            availableForAssignment?: boolean;
            benefitPeriods?: Array<{
              capability: ('materials' | 'community' | 'reviews' | 'support' | string);
              months: number | null;
            }>;
            benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
            coverage?: {
              materialIds: Array<string>;
              productIds: Array<string>;
              wholePlatform?: boolean;
            } | null;
            eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
          product?: {
            id: string;
            name: string;
            priceRevision: number;
          };
          promotion: {
            id: string;
            name: string;
            percent: number;
            revision: number;
          } | null;
          renewalPriceKopecks: number;
          supportMonths?: 3;
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
        access: 'awaiting_payment' | 'preparing' | 'review_required' | 'ready';
        accountId: string;
        amountKopecks: number;
        confirmedAt: string | null;
        createdAt: string;
        environment: 'demo' | 'production' | 'local';
        fiscalization: 'not_configured' | 'pending' | 'confirmed' | 'failed';
        kind: 'initial' | 'one_time' | 'renewal' | 'upgrade';
        paymentId: string | null;
        periodEndsAt: string | null;
        periodIndex: number | null;
        purchaseRef: string;
        refundableKopecks: number | null;
        refundedKopecks: number | null;
        snapshot: {
          communityPolicy?: 'explicit';
          currency: 'RUB';
          firstPriceKopecks: number;
          individualPayment?: {
            basePriceKopecks: number;
            linkId: string;
          };
          offer: {
            archived: boolean;
            availableForAssignment?: boolean;
            benefitPeriods?: Array<{
              capability: ('materials' | 'community' | 'reviews' | 'support' | string);
              months: number | null;
            }>;
            benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
            coverage?: {
              materialIds: Array<string>;
              productIds: Array<string>;
              wholePlatform?: boolean;
            } | null;
            eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
          product?: {
            id: string;
            name: string;
            priceRevision: number;
          };
          promotion: {
            id: string;
            name: string;
            percent: number;
            revision: number;
          } | null;
          renewalPriceKopecks: number;
          supportMonths?: 3;
          timezone: 'Europe/Moscow';
        };
        state: 'prepared' | 'sent' | 'unknown' | 'pending' | 'authorized' | 'confirmed' | 'failed';
        subscriptionRef: string | null;
        terminalRef: string;
        updatedAt: string;
      };
    } | {
      decisions: Array<{
        access: 'keep' | 'revoke';
        accountId: string;
        actorId: string | null;
        amountKopecks: number;
        attempt: {
          amountKopecks: number;
          errorCode: string | null;
          observedStatus: string | null;
          refundRef: string;
          state: 'sent' | 'unknown' | 'confirmed' | 'failed';
          updatedAt: string;
        } | null;
        basis: 'withdrawal' | 'compensation' | null;
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
      refundableKopecks: number | null;
      refundedKopecks: number | null;
    } | {
      outcome: 'respondentImport';
      value: {
        added: number;
        recognized: number;
        total: number;
        unrecognized: number;
      };
    } | {
      outcome: 'respondentLink';
      value: {
        alreadyIssued: boolean;
        code: string;
        productSlug: string | null;
        promotionId: string;
      };
    } | {
      outcome: 'respondents';
      value: {
        issued: number;
        purchased: number;
        respondents: Array<{
          issuedAt: string | null;
          purchased: boolean;
          username: string;
        }>;
        total: number;
      };
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
   * Read the immutable order email of one payment for the billing owner; never cached, listed, searched or exposed through MCP
   * @returns any
   * @throws ApiError
   */
  public readOwnerOrderEmail({
    purchaseRef,
  }: {
    purchaseRef: string,
  }): CancelablePromise<{
    email: string | null;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/billing/admin/payments/{purchaseRef}/order-email',
      path: {
        'purchaseRef': purchaseRef,
      },
    });
  }
  /**
   * Read one private payment link without revealing buyer identity or changing public sales
   * @returns any
   * @throws ApiError
   */
  public readBillingPaymentLink({
    id,
  }: {
    id: string,
  }): CancelablePromise<{
    createdAt: string;
    expiresAt: string | null;
    id: string;
    product: {
      available: boolean;
      id: string;
      kind: 'product' | 'material';
      slug: string | null;
      title: string;
    } | null;
    revision: number;
    snapshot: {
      communityPolicy?: 'explicit';
      currency: 'RUB';
      firstPriceKopecks: number;
      individualPayment?: {
        basePriceKopecks: number;
        linkId: string;
      };
      offer: {
        archived: boolean;
        availableForAssignment?: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        coverage?: {
          materialIds: Array<string>;
          productIds: Array<string>;
          wholePlatform?: boolean;
        } | null;
        eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
      product?: {
        id: string;
        name: string;
        priceRevision: number;
      };
      promotion: {
        id: string;
        name: string;
        percent: number;
        revision: number;
      } | null;
      renewalPriceKopecks: number;
      supportMonths?: 3;
      timezone: 'Europe/Moscow';
    };
    state: 'active' | 'pending' | 'unknown' | 'paid' | 'revoked' | 'expired' | 'changed';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/billing/payment-links/{id}',
      path: {
        'id': id,
      },
      errors: {
        401: `Optional Account proof is invalid`,
        500: `Account resolution failed`,
      },
    });
  }
  /**
   * Read current one-time Product prices and their best available discount
   * @returns any
   * @throws ApiError
   */
  public productPrices({
    capability,
    mode,
    limit = 50,
    cursor,
    productId,
  }: {
    capability?: ('materials' | 'community' | 'reviews' | 'support' | string),
    mode?: 'one_time',
    limit?: number,
    cursor?: string,
    productId?: string,
  }): CancelablePromise<{
    items: Array<{
      communityPolicy?: 'explicit';
      currency: 'RUB';
      firstPriceKopecks: number;
      individualPayment?: {
        basePriceKopecks: number;
        linkId: string;
      };
      offer: {
        archived: boolean;
        availableForAssignment?: boolean;
        benefitPeriods?: Array<{
          capability: ('materials' | 'community' | 'reviews' | 'support' | string);
          months: number | null;
        }>;
        benefits: Array<('materials' | 'community' | 'reviews' | 'support' | string)>;
        coverage?: {
          materialIds: Array<string>;
          productIds: Array<string>;
          wholePlatform?: boolean;
        } | null;
        eligibility?: 'everyone' | 'former_tribute_subscribers' | 'invitation_only';
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
      product?: {
        id: string;
        name: string;
        priceRevision: number;
      };
      promotion: {
        id: string;
        name: string;
        percent: number;
        revision: number;
      } | null;
      renewalPriceKopecks: number;
      supportMonths?: 3;
      timezone: 'Europe/Moscow';
    }>;
    nextCursor: string | null;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/billing/product-prices',
      query: {
        'capability': capability,
        'mode': mode,
        'limit': limit,
        'cursor': cursor,
        'productId': productId,
      },
      errors: {
        401: `Optional Account proof is invalid`,
        500: `Account resolution failed`,
      },
    });
  }
  /**
   * Read mutable Product sales presentation, independent of Intake and price admission
   * @returns any
   * @throws ApiError
   */
  public billingProductSalesStates({
    cursor,
    productId,
  }: {
    cursor?: string,
    productId?: string,
  }): CancelablePromise<{
    items: Array<{
      name: string;
      nextEvent: string;
      priceAfterStartKopecks: number | null;
      productId: string;
      revision: number;
      stage: 'announcement' | 'preorder' | 'running' | 'between';
      startsOn: string | null;
    }>;
    nextCursor: string | null;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/billing/product-sales-states',
      query: {
        'cursor': cursor,
        'productId': productId,
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
  /**
   * Read sale admission for a bounded set of Products without programme, cohort or price presentation
   * @returns any
   * @throws ApiError
   */
  public billingProductSaleAvailability({
    productId,
  }: {
    productId: Array<string>,
  }): CancelablePromise<{
    items: Array<{
      productId: string;
      sold: boolean;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/library/products/sale-availability',
      query: {
        'productId': productId,
      },
      errors: {
        401: `Optional Account proof is invalid`,
        500: `Account resolution failed`,
      },
    });
  }
}
