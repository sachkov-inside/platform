/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class OperationsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Check API and database readiness
   * @returns any The API and PostgreSQL are ready
   * @throws ApiError
   */
  public getApiHealth(): CancelablePromise<{
    database: 'reachable';
    process: 'api';
    status: 'ok';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/health',
      errors: {
        503: `PostgreSQL readiness check failed`,
      },
    });
  }
}
