/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ContentCoversService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read one current public responsive cover rendition
   * @returns binary Public immutable cover bytes
   * @throws ApiError
   */
  public readContentCover({
    width,
    coverId,
  }: {
    width: number,
    coverId: string,
  }): CancelablePromise<Blob> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/content-covers/{coverId}/{width}',
      path: {
        'width': width,
        'coverId': coverId,
      },
    });
  }
}
