/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SalesFunnelIntegrationService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Record bot entries, marketing consent and account links for the sales funnel report
   * @returns any
   * @throws ApiError
   */
  public recordSalesFunnelBotEvents({
    requestBody,
  }: {
    requestBody: {
      contractVersion: 'inside.sales-funnel-events.v1';
      events: Array<({
        contactRef: string;
        eventId: string;
        kind: 'bot_entered';
        occurredAt: string;
        sourceCode: string | null;
      } | {
        contactRef: string;
        eventId: string;
        granted: boolean;
        kind: 'marketing_consent';
        occurredAt: string;
      } | {
        contactRef: string;
        eventId: string;
        kind: 'account_linked';
        occurredAt: string;
        telegramIdentityRef: string;
      })>;
    },
  }): CancelablePromise<{
    accepted: number;
    contractVersion: 'inside.sales-funnel-events.v1';
    duplicates: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/telegram/v1/sales-funnel/events',
      body: requestBody,
      mediaType: 'application/json',
      errors: {
        400: `Envelope or contract version is invalid`,
        401: `Integration credential is missing, invalid or not configured`,
        409: `An event ID was already recorded with different content`,
        503: `Event storage is unavailable; retry the same delivery`,
      },
    });
  }
}
