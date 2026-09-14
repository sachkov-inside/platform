/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class TributeIntegrationService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Durably accept the official raw-body signed Tribute event; unsupported facts require reconciliation
   * @returns any
   * @throws ApiError
   */
  public receiveTributeWebhook({
    requestBody,
  }: {
    /**
     * Official Tribute envelope. Signed unsupported schemas are retained as pending_reconciliation without access.
     */
    requestBody: ({
      created_at: string;
      name: 'new_subscription';
      payload: {
        amount: number;
        channel_id: number;
        channel_name: string;
        currency: string;
        expires_at: string;
        period: 'monthly' | 'quarterly' | 'yearly';
        period_id: number;
        price: number;
        subscription_id: number;
        subscription_name: string;
        telegram_user_id: number;
        telegram_username?: string;
        trb_user_id: string;
        type?: 'regular' | 'gift' | 'trial';
        user_id: number;
      };
      sent_at: string;
    } | {
      created_at: string;
      name: 'renewed_subscription';
      payload: {
        amount: number;
        channel_id: number;
        channel_name: string;
        currency: string;
        email?: string;
        expires_at: string;
        period: 'monthly' | 'quarterly' | 'yearly';
        period_id: number;
        price: number;
        subscription_id: number;
        subscription_name: string;
        telegram_user_id: number;
        telegram_username?: string;
        trb_user_id: string;
        type: 'regular' | 'gift' | 'trial';
        user_id: number;
        web_app_link?: string;
      };
      sent_at: string;
    } | {
      created_at: string;
      name: 'cancelled_subscription';
      payload: {
        amount: number;
        cancel_reason: string;
        channel_id: number;
        channel_name: string;
        currency: string;
        expires_at: string;
        period: 'monthly' | 'quarterly' | 'yearly';
        period_id: number;
        price: number;
        subscription_id: number;
        subscription_name: string;
        telegram_user_id: number;
        telegram_username?: string;
        trb_user_id: string;
        type?: 'regular' | 'gift' | 'trial';
        user_id: number;
      };
      sent_at: string;
    }),
  }): CancelablePromise<{
    ok: boolean;
    receiptRef: string;
    status: 'applied' | 'duplicate' | 'pending_reconciliation' | 'rejected' | 'received';
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/integrations/tribute/v1/webhook',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
