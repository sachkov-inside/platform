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
}
