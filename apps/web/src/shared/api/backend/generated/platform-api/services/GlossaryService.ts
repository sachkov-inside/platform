/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class GlossaryService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Mark a Glossary Term «знаю» or «повторить» for the current Account
   * @returns any
   * @throws ApiError
   */
  public setGlossaryTermMark({
    termId,
    requestBody,
  }: {
    termId: string,
    requestBody: {
      mark: 'known' | 'review';
    },
  }): CancelablePromise<{
    mark: 'known' | 'review';
    markedAt: string;
    termId: string;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/glossary/marks/{termId}',
      path: {
        'termId': termId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read the current Account's marks on at most 100 Glossary Terms
   * @returns any
   * @throws ApiError
   */
  public readGlossaryTermMarks({
    requestBody,
  }: {
    requestBody: {
      termIds: Array<string>;
    },
  }): CancelablePromise<{
    marks: Array<{
      mark: 'known' | 'review';
      markedAt: string;
      termId: string;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/glossary/marks/query',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
