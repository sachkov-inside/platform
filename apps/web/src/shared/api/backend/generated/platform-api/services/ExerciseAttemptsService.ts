/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class ExerciseAttemptsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Read the current Account's latest attempt on each exercise of a Material
   * @returns any
   * @throws ApiError
   */
  public readExerciseAttempts({
    materialId,
  }: {
    materialId: string,
  }): CancelablePromise<{
    items: Array<{
      answer: ({
        kind: 'options';
        optionIds: Array<string>;
      } | {
        kind: 'matches';
        matches: Array<{
          choiceId: string;
          rowId: string;
        }>;
      } | {
        kind: 'sequence';
        stepIds: Array<string>;
      } | {
        kind: 'dontKnow';
      });
      attemptedAt: string;
      exerciseId: string;
      fingerprint: string;
      firstForVersion: boolean;
      result: 'correct' | 'incorrect' | 'dontKnow';
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/exercise-attempts/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
    });
  }
  /**
   * Check the current Account's answer to a Lesson Exercise and record the attempt
   * @returns any
   * @throws ApiError
   */
  public recordExerciseAttempt({
    exerciseId,
    materialId,
    requestBody,
  }: {
    exerciseId: string,
    materialId: string,
    requestBody: {
      answer: ({
        kind: 'options';
        optionIds: Array<string>;
      } | {
        kind: 'matches';
        matches: Array<{
          choiceId: string;
          rowId: string;
        }>;
      } | {
        kind: 'sequence';
        stepIds: Array<string>;
      } | {
        kind: 'dontKnow';
      });
    },
  }): CancelablePromise<{
    answer: ({
      kind: 'options';
      optionIds: Array<string>;
    } | {
      kind: 'matches';
      matches: Array<{
        choiceId: string;
        rowId: string;
      }>;
    } | {
      kind: 'sequence';
      stepIds: Array<string>;
    } | {
      kind: 'dontKnow';
    });
    attemptedAt: string;
    exerciseId: string;
    fingerprint: string;
    firstForVersion: boolean;
    result: 'correct' | 'incorrect' | 'dontKnow';
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/exercise-attempts/materials/{materialId}/exercises/{exerciseId}',
      path: {
        'exerciseId': exerciseId,
        'materialId': materialId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
