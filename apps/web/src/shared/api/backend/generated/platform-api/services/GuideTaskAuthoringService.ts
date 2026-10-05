/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class GuideTaskAuthoringService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
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
