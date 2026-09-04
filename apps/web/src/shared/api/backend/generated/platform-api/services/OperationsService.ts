/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class OperationsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Check API release and schema readiness
   * @returns any The API release and PostgreSQL schema are ready
   * @throws ApiError
   */
  public getApiHealth(): CancelablePromise<{
    database: 'reachable';
    process: 'api';
    release: ({
      release: string;
      sourceSha: string;
    } | {
      release: 'development' | 'test';
      sourceSha: '0000000000000000000000000000000000000000';
    });
    schema: {
      identity: string;
      migrationCount: number;
    };
    status: 'ready';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/health',
      errors: {
        503: `PostgreSQL or schema readiness failed`,
      },
    });
  }
  /**
   * Check the API process identity
   * @returns any The expected API process is alive
   * @throws ApiError
   */
  public getApiLiveness(): CancelablePromise<{
    process: 'api';
    release: ({
      release: string;
      sourceSha: string;
    } | {
      release: 'development' | 'test';
      sourceSha: '0000000000000000000000000000000000000000';
    });
    status: 'alive';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/health/live',
    });
  }
  /**
   * Check API release and schema readiness
   * @returns any The API release and PostgreSQL schema are ready
   * @throws ApiError
   */
  public getApiReadiness(): CancelablePromise<{
    database: 'reachable';
    process: 'api';
    release: ({
      release: string;
      sourceSha: string;
    } | {
      release: 'development' | 'test';
      sourceSha: '0000000000000000000000000000000000000000';
    });
    schema: {
      identity: string;
      migrationCount: number;
    };
    status: 'ready';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/health/ready',
      errors: {
        503: `PostgreSQL or schema readiness failed`,
      },
    });
  }
}
