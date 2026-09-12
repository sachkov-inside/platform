import "server-only";
import type { GuideMode } from "@/shared/guide-mode";
import { ReadingActivityService } from "./generated/platform-api";
import { executeGeneratedRequest } from "./transport-core.server";

export function requestReadingStates(materialIds: string[], accessToken: string) {
  return executeGeneratedRequest((request) => new ReadingActivityService(request).getMaterialReadingStates({ requestBody: { materialIds } }), 200, { accessToken });
}
export function requestSetReadingState(input: { materialId: string; commandId: string; expectedVersion: number; isRead: boolean }, accessToken: string) {
  const { materialId, ...requestBody } = input;
  return executeGeneratedRequest((request) => new ReadingActivityService(request).setMaterialReadingState({ materialId, requestBody }), 200, { accessToken });
}
export function requestReaderGuideMode(accessToken: string) {
  return executeGeneratedRequest((request) => new ReadingActivityService(request).getReaderGuideMode(), 200, { accessToken });
}
export function requestSetReaderGuideMode(guideMode: GuideMode, accessToken: string) {
  return executeGeneratedRequest((request) => new ReadingActivityService(request).setReaderGuideMode({ requestBody: { guideMode } }), 200, { accessToken });
}
