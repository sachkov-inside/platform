/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class GuideTaskAuthoringService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List Guide Task submissions for the author, newest first, by Guide, chapter and task, with the person, report, service mark, criteria of their versions and Author Feedback
   * @returns any
   * @throws ApiError
   */
  public listAuthorTaskSubmissions({
    limit,
    cursor,
    taskCode,
    chapterId,
    guideId,
  }: {
    limit?: number,
    cursor?: string,
    taskCode?: string,
    chapterId?: string,
    guideId?: string,
  }): CancelablePromise<{
    guides: Array<{
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
    nextCursor: string | null;
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
        guideId: string;
        guideName: string | null;
        title: string;
      };
      taskVersion: number;
    }>;
    versions: Array<{
      code: string;
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
      url: '/authoring/guide-tasks/submissions',
      query: {
        'limit': limit,
        'cursor': cursor,
        'taskCode': taskCode,
        'chapterId': chapterId,
        'guideId': guideId,
      },
    });
  }
  /**
   * Write or change the author's comment and «reviewed» mark on a Guide Task submission; an empty comment without the mark removes the feedback
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
      url: '/authoring/guide-tasks/submissions/{submissionId}/feedback',
      path: {
        'submissionId': submissionId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Import a Guide Task against its expected revision; a changed definition creates a new Task Version
   * @returns any
   * @throws ApiError
   */
  public applySourceTask({
    idempotencyKey,
    requestBody,
  }: {
    idempotencyKey: string,
    requestBody: {
      access: 'free' | 'membership';
      afterMaterialSourceId: string | null;
      chapterId: string;
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
        schemaVersion: 1;
        situation: string;
      };
      expectedRevision: number | null;
      guideId: string;
      position: number;
      provenance: {
        commit: string;
        path: string;
        repository: string;
      };
      publicationState: 'published' | 'unpublished';
      relatedMaterialSourceIds: Array<string>;
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
   * Validate an authored Guide Task and read its current revision without writes
   * @returns any
   * @throws ApiError
   */
  public validateSourceTask({
    requestBody,
  }: {
    requestBody: {
      access: 'free' | 'membership';
      afterMaterialSourceId: string | null;
      chapterId?: string;
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
        schemaVersion: 1;
        situation: string;
      };
      guideId?: string;
      position?: number;
      provenance: {
        commit: string;
        path: string;
        repository: string;
      };
      publicationState: 'published' | 'unpublished';
      relatedMaterialSourceIds: Array<string>;
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
    valid: boolean;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/authoring/import/tasks/validate',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
