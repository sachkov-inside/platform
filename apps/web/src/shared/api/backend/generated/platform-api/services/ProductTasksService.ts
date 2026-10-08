/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { RecursiveSchema2schema0 } from '../models/RecursiveSchema2schema0';
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ProductTasksService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List the current Account's submissions of a Product Task with the criteria of their versions and author feedback
   * @returns any
   * @throws ApiError
   */
  public listOwnTaskSubmissions({
    code,
  }: {
    code: string,
  }): CancelablePromise<{
    code: string;
    currentVersion: number;
    submissions: Array<{
      authorFeedback: {
        comment: string | null;
        reviewedAt: string | null;
      } | null;
      note: string;
      reportText: string | null;
      repositoryUrl: string | null;
      source: 'mcp' | 'form';
      submissionId: string;
      submittedAt: string;
      taskVersion: number;
    }>;
    versions: Array<{
      criteria: Array<({
        acceptableEvidence: Array<string>;
        id: string;
        level: 'required' | 'additional';
        requirement: string;
      } | {
        advice?: string;
        explanation: string;
        id: string;
        level: 'required' | 'additional';
        task: string;
      })>;
      version: number;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/product-tasks/{code}/submissions',
      path: {
        'code': code,
      },
    });
  }
  /**
   * Submit a Product Task through the page form against the version the page showed
   * @returns any
   * @throws ApiError
   */
  public submitProductTaskForm({
    code,
    requestBody,
  }: {
    code: string,
    requestBody: {
      note: string;
      reportText?: string;
      repositoryUrl?: string;
      submissionKey: string;
      taskVersion: number;
    },
  }): CancelablePromise<{
    code: string;
    source: 'mcp' | 'form';
    submissionId: string;
    submittedAt: string;
    taskVersion: number;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/accounts/current/product-tasks/{code}/submissions',
      path: {
        'code': code,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read a Product Task page: the full current requirements when open, its place when closed
   * @returns any
   * @throws ApiError
   */
  public readProductTaskPage({
    code,
    slug,
  }: {
    code: string,
    slug: string,
  }): CancelablePromise<({
    access: 'open';
    relatedMaterials: Array<{
      availability: 'available' | 'locked' | 'unavailable';
      slug: string;
      title: string;
    }>;
    reviewProtocol: {
      instructions: Array<string>;
      version: string;
    };
    submission: {
      accepting: boolean;
    };
    task: {
      access: 'free' | 'closed';
      chapter: {
        name: string;
        ordinal: number;
      };
      code: string;
      definition: ({
        criteria: Array<({
          acceptableEvidence: Array<string>;
          id: string;
          level: 'required' | 'additional';
          requirement: string;
        } | {
          advice?: string;
          explanation: string;
          id: string;
          level: 'required' | 'additional';
          task: string;
        })>;
        freedom: string;
        result: Array<string>;
        situation: string;
      } | {
        criteria: Array<({
          acceptableEvidence: Array<string>;
          id: string;
          level: 'required' | 'additional';
          requirement: string;
        } | {
          advice?: string;
          explanation: string;
          id: string;
          level: 'required' | 'additional';
          task: string;
        })>;
        format: 'c';
        freedom: string;
        intro: string;
        schemaVersion: 2;
      });
      page?: {
        artifacts: Array<{
          assetId: string;
          sourceId: string;
          title: string;
        }>;
        body: {
          blocks: Array<RecursiveSchema2schema0>;
          schemaVersion: 1;
        };
        cover: {
          alt: string;
          assetId: string;
        } | null;
        summary: string;
        title: string;
      };
      product: {
        name: string;
        slug: string;
      };
      title: string;
      version: number;
    };
  } | {
    access: 'closed';
    task: {
      chapter: {
        name: string;
        ordinal: number;
      };
      code: string;
      product: {
        name: string;
        slug: string;
      };
      title: string;
    };
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/library/products/{slug}/tasks/{code}',
      path: {
        'code': code,
        'slug': slug,
      },
      errors: {
        401: `Optional Account proof is invalid`,
      },
    });
  }
}
