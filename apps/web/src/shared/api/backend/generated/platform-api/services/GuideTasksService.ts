/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class GuideTasksService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List the current Account's submissions of a Guide Task with the criteria of their versions and author feedback
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
      criteria: Array<{
        acceptableEvidence: Array<string>;
        id: string;
        level: 'required' | 'additional';
        requirement: string;
      }>;
      version: number;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/accounts/current/guide-tasks/{code}/submissions',
      path: {
        'code': code,
      },
    });
  }
  /**
   * Submit a Guide Task through the page form against the version the page showed
   * @returns any
   * @throws ApiError
   */
  public submitGuideTaskForm({
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
      url: '/accounts/current/guide-tasks/{code}/submissions',
      path: {
        'code': code,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read a Guide Task page: the full current requirements when open, its place when closed
   * @returns any
   * @throws ApiError
   */
  public readGuideTaskPage({
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
      access: 'free' | 'membership';
      chapter: {
        name: string;
        ordinal: number;
      };
      code: string;
      definition: {
        criteria: Array<{
          acceptableEvidence: Array<string>;
          id: string;
          level: 'required' | 'additional';
          requirement: string;
        }>;
        freedom: string;
        result: Array<string>;
        situation: string;
      };
      guide: {
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
      guide: {
        name: string;
        slug: string;
      };
      title: string;
    };
  })> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/library/guides/{slug}/tasks/{code}',
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
