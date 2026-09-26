import { describe, expect, it } from "vitest";

import {
  awaitsReconciliation,
  phaseForReconciledVideo,
  nextDetachVideoIds,
  replacedUploadToDetach,
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
      resolveInitialVideoAuthoring({
        primaryVideo: null,
        unselectedUpload: null,
      }),
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

  it("stops carrying an adopted upload once the draft selects, deletes or removes a Video", () => {
    const upload = uploadedVideo("processing");
    const retained = (input: {
      readonly deleteVideoId?: string | null;
      readonly detachVideoIds?: readonly string[];
      readonly primaryVideoId?: string | null;
    }) =>
      retainUnselectedUpload({
        deleteVideoId: input.deleteVideoId ?? null,
        detachVideoIds: input.detachVideoIds ?? [],
        primaryVideoId: input.primaryVideoId ?? null,
        unselectedUpload: upload,
      });
    expect(retained({ primaryVideoId: upload.videoId })).toBeNull();
    expect(retained({ deleteVideoId: upload.videoId })).toBeNull();
    expect(retained({ detachVideoIds: [upload.videoId] })).toBeNull();
    // Agrees with resolveInitialVideoAuthoring: any selected Video ends the recovery.
    expect(retained({ primaryVideoId: otherVideo.videoId })).toBeNull();
    expect(retained({ detachVideoIds: [otherVideo.videoId] })).toEqual(upload);
    expect(retained({})).toEqual(upload);
  });

  it("records «Убрать» until a Save carries it, and forgets it once that Video is selected", () => {
    const removed = uploadedVideo("processing").videoId;
    expect(
      nextDetachVideoIds({
        detachedVideoId: removed,
        detachVideoIds: [],
        primaryVideoId: null,
      }),
    ).toEqual([removed]);
    // Removing the replacement too keeps both decisions, each once.
    expect(
      nextDetachVideoIds({
        detachedVideoId: otherVideo.videoId,
        detachVideoIds: [removed, otherVideo.videoId],
        primaryVideoId: null,
      }),
    ).toEqual([removed, otherVideo.videoId]);
    // Choosing a Video that was removed earlier withdraws that removal only.
    expect(
      nextDetachVideoIds({
        detachedVideoId: null,
        detachVideoIds: [removed, otherVideo.videoId],
        primaryVideoId: removed,
      }),
    ).toEqual([otherVideo.videoId]);
  });

  it("treats an unselected upload as removed only once a different Video has replaced it", () => {
    const replaced = uploadedVideo("processing");
    // A replacement that never started leaves the upload recoverable.
    expect(
      replacedUploadToDetach({
        replaced,
        primaryVideoId: null,
        startedVideoId: null,
      }),
    ).toBeNull();
    // Choosing the same file again resumes that upload instead of replacing it.
    expect(
      replacedUploadToDetach({
        replaced,
        primaryVideoId: null,
        startedVideoId: replaced.videoId,
      }),
    ).toBeNull();
    // The selected Video is replaced through ordinary selection, not removal.
    expect(
      replacedUploadToDetach({
        replaced,
        primaryVideoId: replaced.videoId,
        startedVideoId: otherVideo.videoId,
      }),
    ).toBeNull();
    expect(
      replacedUploadToDetach({
        replaced: null,
        primaryVideoId: null,
        startedVideoId: otherVideo.videoId,
      }),
    ).toBeNull();
    expect(
      replacedUploadToDetach({
        replaced,
        primaryVideoId: null,
        startedVideoId: otherVideo.videoId,
      }),
    ).toBe(replaced.videoId);
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
    expect(phaseForReconciledVideo(uploadedVideo("failed"), null)).toBe(
      "error",
    );
  });
});
