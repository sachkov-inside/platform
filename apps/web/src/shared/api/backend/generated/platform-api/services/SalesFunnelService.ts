/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class SalesFunnelService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read the aggregated sales funnel of one Guide by bot source for the owner
   * @returns any
   * @throws ApiError
   */
  public readSalesFunnelReport({
    to,
    from,
    chapterId,
    guideId,
  }: {
    to: string,
    from: string,
    chapterId?: string,
    guideId?: string,
  }): CancelablePromise<{
    generatedAt: string;
    guides: Array<{
      chapters: Array<{
        id: string;
        name: string;
      }>;
      id: string;
      name: string;
    }>;
    lastBotEventReceivedAt: string | null;
    period: {
      from: string;
      to: string;
    };
    rows: Array<{
      counts: {
        checkout: number | null;
        consented: number | null;
        entered: number | null;
        openedChapter: number | null;
        paid: number | null;
      };
      source: ({
        code: string;
        kind: 'label';
      } | {
        kind: 'unlabelled';
      } | {
        kind: 'outside_bot';
      });
    }>;
    selection: {
      chapterId: string | null;
      guideId: string;
    } | null;
    total: {
      checkout: number | null;
      consented: number | null;
      entered: number | null;
      openedChapter: number | null;
      paid: number | null;
    };
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/sales-funnel/report',
      query: {
        'chapterId': chapterId,
        'guideId': guideId,
        'to': to,
        'from': from,
      },
    });
  }
}
