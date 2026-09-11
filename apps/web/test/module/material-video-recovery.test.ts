import { describe, expect, it } from "vitest";

import {
  awaitsReconciliation,
  phaseForReconciledVideo,
  resolveInitialVideoAuthoring,
  retainUnselectedUpload,
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
  it("hands an upload the Material never selected to the reconciliation poll", () => {
    expect(
      resolveInitialVideoAuthoring({
        primaryVideo: null,
        unselectedUpload: uploadedVideo("processing"),
      }),
    ).toEqual({
      phase: "processing",
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
      "interrupted_unusable",
    );
  });

  it("keeps waiting while the provider is still processing an adopted upload", () => {
    const video = uploadedVideo("processing");
    expect(phaseForReconciledVideo(video, video.videoId)).toBe("processing");
  });

  it("never calls a live transfer of this tab an adopted upload", () => {
    const video = uploadedVideo("uploading");
    expect(phaseForReconciledVideo(video, null)).toBe("processing");
  });

  it("hands a recovered upload back to the Material once it is ready", () => {
    const video = uploadedVideo("ready");
    expect(phaseForReconciledVideo(video, video.videoId)).toBe("ready");
  });

  it("stops carrying an adopted upload once the draft selects or deletes a Video", () => {
    const upload = uploadedVideo("processing");
    expect(
      retainUnselectedUpload({
        deleteVideoId: null,
        primaryVideoId: upload.videoId,
        unselectedUpload: upload,
      }),
    ).toBeNull();
    expect(
      retainUnselectedUpload({
        deleteVideoId: upload.videoId,
        primaryVideoId: null,
        unselectedUpload: upload,
      }),
    ).toBeNull();
    // Agrees with resolveInitialVideoAuthoring: any selected Video ends the recovery.
    expect(
      retainUnselectedUpload({
        deleteVideoId: null,
        primaryVideoId: otherVideo.videoId,
        unselectedUpload: upload,
      }),
    ).toBeNull();
    expect(
      retainUnselectedUpload({
        deleteVideoId: null,
        primaryVideoId: null,
        unselectedUpload: upload,
      }),
    ).toEqual(upload);
  });

  it("keeps asking Kinescope about an adopted upload until it settles", () => {
    const gate = (video: MaterialAuthoringVideo | null) =>
      awaitsReconciliation({ materialId: "m", phase: "processing", video });
    expect(gate(uploadedVideo("uploading"))).toBe(true);
    expect(gate(uploadedVideo("processing"))).toBe(true);
    expect(gate(uploadedVideo("ready"))).toBe(false);
    expect(gate(uploadedVideo("failed"))).toBe(false);
    expect(gate(null)).toBe(false);
  });

  it("asks nothing before the draft exists or outside the waiting state", () => {
    const video = uploadedVideo("processing");
    expect(
      awaitsReconciliation({ materialId: null, phase: "processing", video }),
    ).toBe(false);
    expect(
      awaitsReconciliation({
        materialId: "m",
        phase: "interrupted_unusable",
        video,
      }),
    ).toBe(false);
  });

  it("does not offer a generic retry for an adopted upload the provider failed", () => {
    const video = uploadedVideo("failed");
    expect(phaseForReconciledVideo(video, video.videoId)).toBe(
      "interrupted_unusable",
    );
  });

  it("keeps the ordinary failure state for a Video of this session", () => {
    expect(phaseForReconciledVideo(uploadedVideo("failed"), null)).toBe("error");
  });
});
