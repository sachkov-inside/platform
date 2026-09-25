export { VideosModule, VIDEOS } from "./videos.module.js";
export { VideoAuthoringController } from "./adapters/nest/video-authoring.controller.js";
export { KinescopeWebhookController } from "./adapters/nest/kinescope-webhook.controller.js";
export { assembleVideos } from "./facets/videos/assemble-videos.js";
export { requestVideoDeletion } from "./features/request-video-deletion/request-video-deletion.js";
export { recordVideoDetachment } from "./features/record-video-detachment/record-video-detachment.js";
export {
  assembleVideoDeletionMaintenance,
  VIDEO_DELETION_MAINTENANCE,
  type VideoDeletionMaintenance,
} from "./features/process-video-deletions/process-video-deletions.js";
export { videoAuthoringPresentationSchema } from "./facets/videos/videos.interface.js";
export type {
  VideoAuthoringPresentation,
  VideoPresentation,
  Videos,
} from "./facets/videos/videos.interface.js";
export type {
  ProviderVideo,
  VideoProvider,
} from "./ports/video-provider.js";
export { createConfiguredVideoProvider } from "./shared/configured-video-provider.js";

export { registerVideoTools, type VideoAuthoringTools } from "./adapters/mcp/register-video-tools.js";
