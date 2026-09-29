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
   * Read the Assistant Conversation of a practice with its reviews and Practice Status
   * @returns any
   * @throws ApiError
   */
  public readCourseAssistantPracticeConversation({
    practiceId,
  }: {
    practiceId: string,
  }): CancelablePromise<{
    activeReview: {
      candidates: Array<{
        commitSha: string;
        id: string;
        kind: 'default_branch' | 'pull_request';
        label: string;
        ref: string;
        url: string;
      }> | null;
      checked: {
        commitSha: string;
        id: string;
        kind: 'default_branch' | 'pull_request';
        label: string;
        ref: string;
        url: string;
      } | null;
      completedAt: string | null;
      contextVersion: string;
      failure: {
        code: 'context_version_mismatch' | 'practice_unavailable' | 'repository_access_revoked' | 'repository_too_large' | 'invalid_report' | 'limit_exceeded' | 'model_unavailable' | 'dependency_unavailable' | 'interrupted';
        currentContextVersion: string | null;
      } | null;
      id: string;
      kind: 'initial' | 'recheck';
      practiceId: string;
      previousReviewId: string | null;
      repository: {
        fullName: string;
        htmlUrl: string;
      };
      requestedAt: string;
      result: {
        criteria: Array<{
          changed: boolean;
          criterionId: string;
          evidence: Array<{
            endLine: number | null;
            path: string;
            startLine: number | null;
            url: string;
          }>;
          explanation: string;
          nextStep: string | null;
          previousStatus: 'confirmed' | 'violation' | 'not_verified' | null;
          status: 'confirmed' | 'violation' | 'not_verified';
        }>;
        practiceStatus: 'accepted' | 'needs_work';
        summary: string;
      } | null;
      state: 'queued' | 'awaiting_choice' | 'running' | 'completed' | 'failed';
    } | null;
    messages: Array<{
      createdAt: string;
      id: string;
      kind: 'text' | 'candidate_question' | 'review_result';
      review: {
        candidates: Array<{
          commitSha: string;
          id: string;
          kind: 'default_branch' | 'pull_request';
          label: string;
          ref: string;
          url: string;
        }> | null;
        checked: {
          commitSha: string;
          id: string;
          kind: 'default_branch' | 'pull_request';
          label: string;
          ref: string;
          url: string;
        } | null;
        completedAt: string | null;
        contextVersion: string;
        failure: {
          code: 'context_version_mismatch' | 'practice_unavailable' | 'repository_access_revoked' | 'repository_too_large' | 'invalid_report' | 'limit_exceeded' | 'model_unavailable' | 'dependency_unavailable' | 'interrupted';
          currentContextVersion: string | null;
        } | null;
        id: string;
        kind: 'initial' | 'recheck';
        practiceId: string;
        previousReviewId: string | null;
        repository: {
          fullName: string;
          htmlUrl: string;
        };
        requestedAt: string;
        result: {
          criteria: Array<{
            changed: boolean;
            criterionId: string;
            evidence: Array<{
              endLine: number | null;
              path: string;
              startLine: number | null;
              url: string;
            }>;
            explanation: string;
            nextStep: string | null;
            previousStatus: 'confirmed' | 'violation' | 'not_verified' | null;
            status: 'confirmed' | 'violation' | 'not_verified';
          }>;
          practiceStatus: 'accepted' | 'needs_work';
          summary: string;
        } | null;
        state: 'queued' | 'awaiting_choice' | 'running' | 'completed' | 'failed';
      } | null;
      role: 'participant' | 'assistant';
      text: string | null;
    }>;
    practice: {
      contextVersion: string;
      criteria: Array<{
        id: string;
        requirement: string;
      }>;
      practiceId: string;
      title: string;
    } | null;
    status: 'not_started' | 'in_review' | 'needs_work' | 'accepted';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/course-assistant/practices/{practiceId}/conversation',
      path: {
        'practiceId': practiceId,
      },
    });
  }
  /**
   * Queue a Practice Review of the current Account's linked repository, or return the running one
   * @returns any
   * @throws ApiError
   */
  public requestCourseAssistantPracticeReview({
    practiceId,
    requestBody,
  }: {
    practiceId: string,
    requestBody: {
      candidate?: ({
        kind: 'default_branch';
      } | {
        kind: 'pull_request';
        number: number;
      });
      expectedContextVersion: string;
    },
  }): CancelablePromise<{
    candidates: Array<{
      commitSha: string;
      id: string;
      kind: 'default_branch' | 'pull_request';
      label: string;
      ref: string;
      url: string;
    }> | null;
    checked: {
      commitSha: string;
      id: string;
      kind: 'default_branch' | 'pull_request';
      label: string;
      ref: string;
      url: string;
    } | null;
    completedAt: string | null;
    contextVersion: string;
    failure: {
      code: 'context_version_mismatch' | 'practice_unavailable' | 'repository_access_revoked' | 'repository_too_large' | 'invalid_report' | 'limit_exceeded' | 'model_unavailable' | 'dependency_unavailable' | 'interrupted';
      currentContextVersion: string | null;
    } | null;
    id: string;
    kind: 'initial' | 'recheck';
    practiceId: string;
    previousReviewId: string | null;
    repository: {
      fullName: string;
      htmlUrl: string;
    };
    requestedAt: string;
    result: {
      criteria: Array<{
        changed: boolean;
        criterionId: string;
        evidence: Array<{
          endLine: number | null;
          path: string;
          startLine: number | null;
          url: string;
        }>;
        explanation: string;
        nextStep: string | null;
        previousStatus: 'confirmed' | 'violation' | 'not_verified' | null;
        status: 'confirmed' | 'violation' | 'not_verified';
      }>;
      practiceStatus: 'accepted' | 'needs_work';
      summary: string;
    } | null;
    state: 'queued' | 'awaiting_choice' | 'running' | 'completed' | 'failed';
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/course-assistant/practices/{practiceId}/reviews',
      path: {
        'practiceId': practiceId,
      },
      body: requestBody,
      mediaType: 'application/json',
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
  /**
   * Read one Practice Review of the current Account
   * @returns any
   * @throws ApiError
   */
  public readCourseAssistantPracticeReview({
    reviewId,
  }: {
    reviewId: string,
  }): CancelablePromise<{
    candidates: Array<{
      commitSha: string;
      id: string;
      kind: 'default_branch' | 'pull_request';
      label: string;
      ref: string;
      url: string;
    }> | null;
    checked: {
      commitSha: string;
      id: string;
      kind: 'default_branch' | 'pull_request';
      label: string;
      ref: string;
      url: string;
    } | null;
    completedAt: string | null;
    contextVersion: string;
    failure: {
      code: 'context_version_mismatch' | 'practice_unavailable' | 'repository_access_revoked' | 'repository_too_large' | 'invalid_report' | 'limit_exceeded' | 'model_unavailable' | 'dependency_unavailable' | 'interrupted';
      currentContextVersion: string | null;
    } | null;
    id: string;
    kind: 'initial' | 'recheck';
    practiceId: string;
    previousReviewId: string | null;
    repository: {
      fullName: string;
      htmlUrl: string;
    };
    requestedAt: string;
    result: {
      criteria: Array<{
        changed: boolean;
        criterionId: string;
        evidence: Array<{
          endLine: number | null;
          path: string;
          startLine: number | null;
          url: string;
        }>;
        explanation: string;
        nextStep: string | null;
        previousStatus: 'confirmed' | 'violation' | 'not_verified' | null;
        status: 'confirmed' | 'violation' | 'not_verified';
      }>;
      practiceStatus: 'accepted' | 'needs_work';
      summary: string;
    } | null;
    state: 'queued' | 'awaiting_choice' | 'running' | 'completed' | 'failed';
  }> {
    return this.httpRequest.request({
      method: 'GET',
      url: '/course-assistant/reviews/{reviewId}',
      path: {
        'reviewId': reviewId,
      },
    });
  }
  /**
   * Choose which branch or pull request a waiting Practice Review checks
   * @returns any
   * @throws ApiError
   */
  public chooseCourseAssistantReviewCandidate({
    reviewId,
    requestBody,
  }: {
    reviewId: string,
    requestBody: {
      candidateId: string;
    },
  }): CancelablePromise<{
    candidates: Array<{
      commitSha: string;
      id: string;
      kind: 'default_branch' | 'pull_request';
      label: string;
      ref: string;
      url: string;
    }> | null;
    checked: {
      commitSha: string;
      id: string;
      kind: 'default_branch' | 'pull_request';
      label: string;
      ref: string;
      url: string;
    } | null;
    completedAt: string | null;
    contextVersion: string;
    failure: {
      code: 'context_version_mismatch' | 'practice_unavailable' | 'repository_access_revoked' | 'repository_too_large' | 'invalid_report' | 'limit_exceeded' | 'model_unavailable' | 'dependency_unavailable' | 'interrupted';
      currentContextVersion: string | null;
    } | null;
    id: string;
    kind: 'initial' | 'recheck';
    practiceId: string;
    previousReviewId: string | null;
    repository: {
      fullName: string;
      htmlUrl: string;
    };
    requestedAt: string;
    result: {
      criteria: Array<{
        changed: boolean;
        criterionId: string;
        evidence: Array<{
          endLine: number | null;
          path: string;
          startLine: number | null;
          url: string;
        }>;
        explanation: string;
        nextStep: string | null;
        previousStatus: 'confirmed' | 'violation' | 'not_verified' | null;
        status: 'confirmed' | 'violation' | 'not_verified';
      }>;
      practiceStatus: 'accepted' | 'needs_work';
      summary: string;
    } | null;
    state: 'queued' | 'awaiting_choice' | 'running' | 'completed' | 'failed';
  }> {
    return this.httpRequest.request({
      method: 'POST',
      url: '/course-assistant/reviews/{reviewId}/candidate',
      path: {
        'reviewId': reviewId,
      },
      body: requestBody,
      mediaType: 'application/json',
    });
  }
}
