import "server-only";
import { CourseAssistantService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

export function requestCourseAssistantParticipant(accessToken: string) {
  return executeGeneratedRequest(
    (request) =>
      new CourseAssistantService(request).readCourseAssistantParticipant(),
    200,
    { accessToken },
  );
}

export function requestAcknowledgeCourseAssistantDataNotice(
  noticeVersion: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CourseAssistantService(request).acknowledgeCourseAssistantDataNotice({
        requestBody: { noticeVersion },
      }),
    200,
    { accessToken },
  );
}

export function requestBeginCourseAssistantRepositoryConnection(
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CourseAssistantService(
        request,
      ).beginCourseAssistantRepositoryConnection(),
    200,
    { accessToken },
  );
}

export function requestCompleteCourseAssistantRepositoryConnection(
  requestBody: {
    readonly state: string;
    readonly code: string;
    readonly installationId: number;
  },
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CourseAssistantService(
        request,
      ).completeCourseAssistantRepositoryConnection({ requestBody }),
    200,
    { accessToken },
  );
}

export function requestCourseAssistantRepositories(accessToken: string) {
  return executeGeneratedRequest(
    (request) =>
      new CourseAssistantService(request).listCourseAssistantRepositories(),
    200,
    { accessToken },
  );
}

export function requestLinkCourseAssistantRepository(
  requestBody: {
    readonly installationId: number;
    readonly repositoryId: number;
  },
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CourseAssistantService(request).linkCourseAssistantRepository({
        requestBody,
      }),
    200,
    { accessToken },
  );
}

export function requestDisconnectCourseAssistantRepository(
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CourseAssistantService(request).disconnectCourseAssistantRepository(),
    200,
    { accessToken },
  );
}

export function requestCourseAssistantPracticeConversation(
  practiceId: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CourseAssistantService(
        request,
      ).readCourseAssistantPracticeConversation({ practiceId }),
    200,
    { accessToken },
  );
}

export function requestCourseAssistantPracticeReview(
  practiceId: string,
  requestBody: {
    readonly expectedContextVersion: string;
    readonly candidate?:
      | { readonly kind: "default_branch" }
      | { readonly kind: "pull_request"; readonly number: number };
  },
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CourseAssistantService(request).requestCourseAssistantPracticeReview({
        practiceId,
        requestBody,
      }),
    202,
    { accessToken },
  );
}

export function requestReadCourseAssistantPracticeReview(
  reviewId: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CourseAssistantService(request).readCourseAssistantPracticeReview({
        reviewId,
      }),
    200,
    { accessToken },
  );
}

export function requestChooseCourseAssistantReviewCandidate(
  reviewId: string,
  candidateId: string,
  accessToken: string,
) {
  return executeGeneratedRequest(
    (request) =>
      new CourseAssistantService(request).chooseCourseAssistantReviewCandidate({
        reviewId,
        requestBody: { candidateId },
      }),
    202,
    { accessToken },
  );
}
