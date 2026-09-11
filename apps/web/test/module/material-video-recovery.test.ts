import { describe, expect, it } from "vitest";

import {
  phaseForReconciledVideo,
  resolveInitialVideoAuthoring,
  type MaterialAuthoringVideo,
} from "@/features/material-video/model/video";

const uploadedVideo = (
  state: MaterialAuthoringVideo["state"],
): MaterialAuthoringVideo => ({
  origin: "platform_upload",
  state,
  title: "Разбор проверки skill contract",
  videoId: "30000000-0000-4000-8000-000000000001",
});

const otherVideo: MaterialAuthoringVideo = {
  origin: "platform_upload",
  state: "ready",
  title: "Уже выбранное видео",
  videoId: "30000000-0000-4000-8000-000000000002",
};

describe("Interrupted upload recovery", () => {
  it("adopts an upload the Material never selected", () => {
    expect(
      resolveInitialVideoAuthoring({
        primaryVideo: null,
        unselectedUpload: uploadedVideo("processing"),
      }),
    ).toEqual({
      phase: "interrupted",
      recoveredVideoId: uploadedVideo("processing").videoId,
      video: uploadedVideo("processing"),
    });
  });

  it("keeps the selected Video when one is already saved", () => {
    expect(
      resolveInitialVideoAuthoring({
        primaryVideo: otherVideo,
        unselectedUpload: uploadedVideo("uploading"),
      }),
    ).toEqual({ phase: "ready", recoveredVideoId: null, video: otherVideo });
  });

  it("opens an empty editor when nothing is pending", () => {
    expect(
      resolveInitialVideoAuthoring({ primaryVideo: null, unselectedUpload: null }),
    ).toEqual({ phase: "idle", recoveredVideoId: null, video: null });
  });

  it("names an adopted upload the provider never received in full", () => {
    const video = uploadedVideo("uploading");
    expect(phaseForReconciledVideo(video, video.videoId)).toBe(
      "interrupted_incomplete",
    );
  });

  it("keeps waiting while the provider is still processing an adopted upload", () => {
    const video = uploadedVideo("processing");
    expect(phaseForReconciledVideo(video, video.videoId)).toBe("processing");
  });

  it("never calls a live transfer of this tab an interrupted upload", () => {
    const video = uploadedVideo("uploading");
    expect(phaseForReconciledVideo(video, null)).toBe("processing");
  });

  it("hands a recovered upload back to the Material once it is ready", () => {
    const video = uploadedVideo("ready");
    expect(phaseForReconciledVideo(video, video.videoId)).toBe("ready");
  });

  it("does not offer a generic retry for a Video the provider failed", () => {
    const video = uploadedVideo("failed");
    expect(phaseForReconciledVideo(video, video.videoId)).toBe("error");
  });
});
