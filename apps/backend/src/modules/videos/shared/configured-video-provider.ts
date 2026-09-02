import type { PlatformConfig } from "../../../config/platform-config.js";
import { createKinescopeVideoProvider } from "../adapters/kinescope/kinescope-video-provider.js";
import { createTestVideoProvider } from "../adapters/kinescope/test-video-provider.js";
import type { VideoProvider } from "../ports/video-provider.js";

export function createConfiguredVideoProvider(
  config: Pick<PlatformConfig, "kinescope">,
): VideoProvider {
  return config.kinescope.providerMode === "real"
    ? createKinescopeVideoProvider({
        apiBaseUrl: config.kinescope.apiBaseUrl,
        apiToken: config.kinescope.apiToken,
        uploaderBaseUrl: config.kinescope.uploaderBaseUrl,
      })
    : createTestVideoProvider();
}
