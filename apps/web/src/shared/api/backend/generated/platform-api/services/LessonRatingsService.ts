/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class LessonRatingsService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * Remove the current Account's rating of a lesson
   * @returns any
   * @throws ApiError
   */
  public clearLessonRating({
    materialId,
  }: {
    materialId: string,
  }): CancelablePromise<{
    rating: 'like' | 'dislike' | null;
  }> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/lesson-ratings/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
    });
  }
  /**
   * Read the current Account's rating of a lesson
   * @returns any
   * @throws ApiError
   */
  public readLessonRating({
    materialId,
  }: {
    materialId: string,
  }): CancelablePromise<{
    rating: 'like' | 'dislike' | null;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/lesson-ratings/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
    });
  }
  /**
   * Set the current Account's like or dislike of a lesson it may read; replaces the previous one
   * @returns any
   * @throws ApiError
   */
  public rateLesson({
    materialId,
    requestBody,
  }: {
    materialId: string,
    requestBody: {
      rating: 'like' | 'dislike';
    },
  }): CancelablePromise<{
    rating: 'like' | 'dislike' | null;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/lesson-ratings/materials/{materialId}',
      path: {
        'materialId': materialId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Check if the current Account already sent text feedback on this lesson
   * @returns any
   * @throws ApiError
   */
  public readLessonFeedback({
    materialId,
  }: {
    materialId: string,
  }): CancelablePromise<{
    submitted: boolean;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/lesson-ratings/materials/{materialId}/feedback',
      path: {
        'materialId': materialId,
      },
    });
  }
  /**
   * Save the current Account's first text feedback on a lesson it may read
   * @returns any
   * @throws ApiError
   */
  public submitLessonFeedback({
    materialId,
    requestBody,
  }: {
    materialId: string,
    requestBody: {
      text: string;
    },
  }): CancelablePromise<{
    submitted: boolean;
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/lesson-ratings/materials/{materialId}/feedback',
      path: {
        'materialId': materialId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
