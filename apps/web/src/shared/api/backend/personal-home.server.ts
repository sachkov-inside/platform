import "server-only";
import { PersonalHomeService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";
export function requestContinueMaterials(accessToken: string) {
  return executeGeneratedRequest((request) => new PersonalHomeService(request).getContinueMaterials(), 200, { accessToken });
}
export function requestRecordMaterialOpen(requestBody: { materialId: string; contentVersion: number; commandId: string }, accessToken: string) {
  return executeGeneratedRequest((request) => new PersonalHomeService(request).recordMaterialOpen({ requestBody }), 200, { accessToken });
}

export function requestLearningHome(accessToken: string) {
  return executeGeneratedRequest((request) => new PersonalHomeService(request).getLearningHome(), 200, { accessToken });
}
export function requestSeriesContinuation(slug: string, accessToken: string) {
  return executeGeneratedRequest((request) => new PersonalHomeService(request).getSeriesContinuation({ slug }), 200, { accessToken });
}
