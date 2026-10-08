/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ProductTaskAuthoringService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Import a Product Task against its expected revision; a changed definition creates a new Task Version
   * @returns any
   * @throws ApiError
   */
  public applySourceTask({
    idempotencyKey,
    requestBody,
  }: {
    idempotencyKey: string,
    requestBody: {
      access: 'free' | 'closed';
      afterMaterialSourceId: string | null;
      chapterId: string;
      code: string;
      definition: ({
        criteria: Array<{
          acceptableEvidence: Array<string>;
          id: string;
          level: 'required' | 'additional';
          requirement: string;
        }>;
        freedom: string;
        result: Array<string>;
        schemaVersion: 1;
        situation: string;
      } | {
        criteria: Array<{
          acceptableEvidence: Array<string>;
          advice?: string;
          explanation: string;
          id: string;
          level: 'required' | 'additional';
          task: string;
        }>;
        format: 'c';
        freedom: string;
        intro: string;
        schemaVersion: 2;
      });
      expectedRevision: number | null;
      page?: Record<string, any>;
      pageBody?: {
        doc: Record<string, any>;
        schemaVersion: 1;
      };
      position: number;
      productId: string;
      provenance: {
        commit: string;
        path: string;
        repository: string;
      };
      publicationState: 'published' | 'unpublished';
      relatedMaterialSourceIds: Array<string>;
      resolvedImages: Record<string, {
        assetId: string;
        materialId: string;
      }>;
      resolvedLinks: Record<string, string>;
      sourceId: string;
      title: string;
    },
  }): CancelablePromise<{
    code: string;
    currentVersion: number;
    definitionDigest: string;
    publicationState: 'published' | 'unpublished';
    revision: number;
    taskId: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/tasks/apply',
      headers: {
        'idempotency-key': idempotencyKey,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Validate an authored Product Task and read its current revision without writes
   * @returns any
   * @throws ApiError
   */
  public validateSourceTask({
    requestBody,
  }: {
    requestBody: {
      access: 'free' | 'closed';
      afterMaterialSourceId: string | null;
      chapterId?: string;
      code: string;
      definition: ({
        criteria: Array<{
          acceptableEvidence: Array<string>;
          id: string;
          level: 'required' | 'additional';
          requirement: string;
        }>;
        freedom: string;
        result: Array<string>;
        schemaVersion: 1;
        situation: string;
      } | {
        criteria: Array<{
          acceptableEvidence: Array<string>;
          advice?: string;
          explanation: string;
          id: string;
          level: 'required' | 'additional';
          task: string;
        }>;
        format: 'c';
        freedom: string;
        intro: string;
        schemaVersion: 2;
      });
      page?: Record<string, any>;
      pageBody?: {
        doc: Record<string, any>;
        schemaVersion: 1;
      };
      position?: number;
      productId?: string;
      provenance: {
        commit: string;
        path: string;
        repository: string;
      };
      publicationState: 'published' | 'unpublished';
      relatedMaterialSourceIds: Array<string>;
      resolvedImages: Record<string, {
        assetId: string;
        materialId: string;
      }>;
      resolvedLinks: Record<string, string>;
      sourceId: string;
      title: string;
    },
  }): CancelablePromise<{
    current: {
      code: string;
      currentVersion: number;
      definitionDigest: string;
      publicationState: 'published' | 'unpublished';
      revision: number;
      taskId: string;
    } | null;
    migration: {
      materialId: string;
    } | null;
    valid: boolean;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/tasks/validate',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * List Product Task submissions for the author, newest first, by Product, chapter and task, with the person, report, service mark, criteria of their versions and Author Feedback
   * @returns any
   * @throws ApiError
   */
  public listAuthorTaskSubmissions({
    limit,
    cursor,
    taskCode,
    chapterId,
    productId,
  }: {
    limit?: number,
    cursor?: string,
    taskCode?: string,
    chapterId?: string,
    productId?: string,
  }): CancelablePromise<{
    nextCursor: string | null;
    products: Array<{
      chapters: Array<{
        id: string;
        name: string;
        tasks: Array<{
          code: string;
          title: string;
        }>;
      }>;
      id: string;
      name: string;
    }>;
    submissions: Array<{
      authorFeedback: {
        comment: string | null;
        reviewedAt: string | null;
        updatedAt: string;
      } | null;
      note: string;
      person: {
        accountId: string;
        telegramIdentityRef: string | null;
      };
      reportText: string | null;
      reviewReport: {
        criteria: Array<{
          criterionId: string;
          evidence: string;
          gap: string;
          obtainedByRun: boolean;
          status: 'confirmed' | 'violation' | 'not_verified';
        }>;
      } | null;
      serviceMark: {
        branch: string | null;
        commit: string | null;
        repositoryUrl: string | null;
        uncommittedChanges: boolean | null;
      };
      source: 'mcp' | 'form';
      submissionId: string;
      submittedAt: string;
      task: {
        chapterId: string;
        chapterName: string | null;
        code: string;
        currentVersion: number;
        productId: string;
        productName: string | null;
        title: string;
      };
      taskVersion: number;
    }>;
    versions: Array<{
      code: string;
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
      url: '/authoring/product-tasks/submissions',
      query: {
        'limit': limit,
        'cursor': cursor,
        'taskCode': taskCode,
        'chapterId': chapterId,
        'productId': productId,
      },
    });
  }
  /**
   * Write or change the author's comment and «reviewed» mark on a Product Task submission; an empty comment without the mark removes the feedback
   * @returns any
   * @throws ApiError
   */
  public saveAuthorTaskFeedback({
    submissionId,
    requestBody,
  }: {
    submissionId: string,
    requestBody: {
      comment: string | null;
      reviewed: boolean;
    },
  }): CancelablePromise<{
    authorFeedback: {
      comment: string | null;
      reviewedAt: string | null;
      updatedAt: string;
    } | null;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/authoring/product-tasks/submissions/{submissionId}/feedback',
      path: {
        'submissionId': submissionId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
