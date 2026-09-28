/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import type { BaseHttpRequest } from '../core/BaseHttpRequest';
export class CourseAssistantService {
  constructor(public readonly httpRequest: BaseHttpRequest) {}
  /**
   * List every participant's Repository Link history for the author
   * @returns any
   * @throws ApiError
   */
  public listCourseAssistantRepositoryLinks(): CancelablePromise<{
    links: Array<{
      accountId: string;
      connectedAt: string;
      disconnectedAt: string | null;
      repositoryFullName: string;
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/course-assistant/author/repository-links',
    });
  }
  /**
   * Record that the current Account read the data notice version
   * @returns any
   * @throws ApiError
   */
  public acknowledgeCourseAssistantDataNotice({
    requestBody,
  }: {
    requestBody: {
      noticeVersion: string;
    },
  }): CancelablePromise<{
    acknowledgedAt: string;
    version: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/course-assistant/data-notice/acknowledgement',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Read the data notice and Repository Link of the current Account's course assistant
   * @returns any
   * @throws ApiError
   */
  public readCourseAssistantParticipant(): CancelablePromise<{
    dataNotice: {
      acknowledgedAt: string | null;
      version: string;
    };
    repositoryLink: {
      access: 'available' | 'revoked' | 'unknown';
      connectedAt: string;
      installationId: number;
      repository: {
        fullName: string;
        htmlUrl: string;
        id: number;
      };
    } | null;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/course-assistant/participant',
    });
  }
  /**
   * List repositories the current Account's verified installations open
   * @returns any
   * @throws ApiError
   */
  public listCourseAssistantRepositories(): CancelablePromise<{
    repositories: Array<{
      installationId: number;
      repository: {
        fullName: string;
        htmlUrl: string;
        id: number;
      };
    }>;
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/course-assistant/repositories',
    });
  }
  /**
   * Start installing the course GitHub App for the current Account
   * @returns any
   * @throws ApiError
   */
  public beginCourseAssistantRepositoryConnection(): CancelablePromise<{
    installUrl: string;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/course-assistant/repository-connections',
    });
  }
  /**
   * Verify the GitHub App installation returned from GitHub and link its only repository
   * @returns any
   * @throws ApiError
   */
  public completeCourseAssistantRepositoryConnection({
    requestBody,
  }: {
    requestBody: {
      code: string;
      installationId: number;
      state: string;
    },
  }): CancelablePromise<{
    repositories: Array<{
      installationId: number;
      repository: {
        fullName: string;
        htmlUrl: string;
        id: number;
      };
    }>;
    repositoryLink: {
      access: 'available' | 'revoked' | 'unknown';
      connectedAt: string;
      installationId: number;
      repository: {
        fullName: string;
        htmlUrl: string;
        id: number;
      };
    } | null;
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/course-assistant/repository-connections/completion',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
  /**
   * Disconnect the current Account's Repository Link, keeping history
   * @returns any
   * @throws ApiError
   */
  public disconnectCourseAssistantRepository(): CancelablePromise<{
    disconnected: boolean;
  }> {
    return this.httpRequest.request({
      method: 'DELETE',
      url: '/course-assistant/repository-link',
    });
  }
  /**
   * Choose or change the current Account's Repository Link
   * @returns any
   * @throws ApiError
   */
  public linkCourseAssistantRepository({
    requestBody,
  }: {
    requestBody: {
      installationId: number;
      repositoryId: number;
    },
  }): CancelablePromise<{
    access: 'available' | 'revoked' | 'unknown';
    connectedAt: string;
    installationId: number;
    repository: {
      fullName: string;
      htmlUrl: string;
      id: number;
    };
  }> {
    return this.httpRequest.request({
      method: 'PUT',
      url: '/course-assistant/repository-link',
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
