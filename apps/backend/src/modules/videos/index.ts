export { VideosModule, VIDEOS } from "./videos.module.js";
export { assembleVideos } from "./facets/videos/assemble-videos.js";
export type {
  VideoAccess,
  VideoAccessFacts,
  VideoDto,
  VideoError,
  VideoPlayback,
  VideoPresentation,
  VideoResult,
  Videos,
  VideoState,
} from "./facets/videos/videos.interface.js";
export type { ProviderVideo, VideoProvider } from "./ports/video-provider.js";
