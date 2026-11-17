import type {
  attachMaterialVideo,
  initMaterialVideoUpload,
  reconcileMaterialVideo,
  retryMaterialVideoDeletion,
  VideoMutationResult,
} from "../api/video-authoring.browser";
import {
  clearBrowserVideoUploadAttempt,
  clearBrowserVideoUploadAttemptsForVideo,
  getOrCreateBrowserVideoUploadAttempt,
  recordBrowserVideoUploadAttempt,
  type BrowserVideoUploadAttempt,
} from "../api/video-upload-attempt.browser";
import {
  startResumableVideoUpload,
  type ResumableVideoUpload,
} from "../api/video-upload-transfer.browser";
import {
  awaitsReconciliation,
  phaseForReconciledVideo,
  phaseForVideo,
  replacedUploadToDetach,
  resolveInitialVideoAuthoring,
  type MaterialAuthoringVideo,
  type MaterialVideo,
  type MaterialVideoAuthoringPhase,
} from "../model/video";

const VIDEO_RECONCILIATION_POLL_INTERVAL_MILLISECONDS = 5_000;

export interface VideoAuthoringSelection {
  readonly access: "free" | "closed";
  readonly materialId: string | null;
  readonly primaryVideo: MaterialAuthoringVideo | null;
  readonly unselectedUpload: MaterialAuthoringVideo | null;
  readonly latestVideoDeletion: MaterialAuthoringVideo | null;
  readonly deleteVideoId: string | null;
  readonly onChange: (
    primaryVideo: MaterialAuthoringVideo | null,
    deleteVideoId: string | null,
    detachedVideoId: string | null,
  ) => void;
}
interface Commands {
  readonly uploadVideo: typeof initMaterialVideoUpload;
  readonly attachVideo: typeof attachMaterialVideo;
  readonly reconcileVideo: typeof reconcileMaterialVideo;
  readonly retryDeletion: typeof retryMaterialVideoDeletion;
}
interface Snapshot {
  readonly phase: MaterialVideoAuthoringPhase;
  readonly progress: number;
  readonly providerVideoId: string;
  readonly video: MaterialAuthoringVideo | null;
  readonly recoveredVideoId: string | null;
  readonly deletionVideo: MaterialAuthoringVideo | null;
}

/** Owns one author's upload attempt and serial reconciliation reads. Construction is inert. */
export function createVideoAuthoringSession(
  initialSelection: VideoAuthoringSelection,
  { uploadVideo, attachVideo, reconcileVideo, retryDeletion }: Commands,
) {
  let selection = initialSelection;
  const initial = resolveInitialVideoAuthoring(initialSelection);
  let snapshot: Snapshot = {
    ...initial,
    progress: 0,
    providerVideoId: "",
    deletionVideo: selection.latestVideoDeletion,
  };
  const serverSnapshot = snapshot;
  const listeners = new Set<() => void>();
  let operation = 0;
  let deletionFactsRevision = 0;
  let uploadAttempt: BrowserVideoUploadAttempt | null = null;
  let uploadTransfer: Promise<ResumableVideoUpload | null> | null = null;
  let uploadLifetime: AbortController | null = null;
  const pendingReconciliations = new Map<string, Promise<undefined>>();
  interface Poll {
    readonly inputs: readonly unknown[];
    readonly cancel: () => void;
  }
  let processingPoll: Poll | null = null;
  let deletionPoll: Poll | null = null;
  const cancelPolling = () => {
    processingPoll?.cancel();
    deletionPoll?.cancel();
    processingPoll = null;
    deletionPoll = null;
  };
  const patch = (next: Partial<Snapshot>) => {
    if (
      Object.entries(next).every(
        ([key, value]) => Reflect.get(snapshot, key) === value,
      )
    )
      return;
    snapshot = { ...snapshot, ...next };
    refreshPolling();
    for (const listener of listeners) listener();
  };
  const setVideo = (video: Snapshot["video"]) => {
    patch({ video });
  };
  const setPhase = (phase: Snapshot["phase"]) => {
    patch({ phase });
  };
  const setProgress = (progress: number) => {
    patch({ progress });
  };
  const setRecoveredVideoId = (recoveredVideoId: string | null) => {
    patch({ recoveredVideoId });
  };
  const setDeletionVideo = (deletionVideo: Snapshot["deletionVideo"]) => {
    // Equal refreshed props do not invalidate a command. A different target or state does,
    // including changing away and back before the old command settles.
    if (
      snapshot.deletionVideo?.videoId !== deletionVideo?.videoId ||
      snapshot.deletionVideo?.state !== deletionVideo?.state
    )
      deletionFactsRevision += 1;
    patch({ deletionVideo });
  };

  const applyVideoResult = (result: VideoMutationResult<MaterialVideo>) => {
    if (result.kind !== "ready") {
      setPhase("error");
      return;
    }
    if (isDeletionState(result.value.state)) {
      setDeletionVideo(result.value);
      return;
    }
    setVideo(result.value);
    const next = phaseForReconciledVideo(
      result.value,
      snapshot.recoveredVideoId,
    );
    if (next === "ready") {
      if (uploadAttempt?.videoId === result.value.videoId) {
        clearBrowserVideoUploadAttempt(uploadAttempt);
        uploadAttempt = null;
      }
      uploadTransfer = null;
      uploadLifetime = null;
      setRecoveredVideoId(null);
      selection.onChange(result.value, selection.deleteVideoId, null);
    }
    setPhase(next);
  };

  const reconcile = async (
    videoId: string,
    isCurrent: () => boolean = () => true,
  ) => {
    const revision = operation;
    // Activity and refreshed server props restart effects without ending an outstanding read.
    // Wait for the previous lifetime, discard its answer, then make a fresh current read.
    let previous = pendingReconciliations.get(videoId);
    while (previous !== undefined) {
      await previous;
      if (revision !== operation || !isCurrent()) return;
      previous = pendingReconciliations.get(videoId);
    }
    if (revision !== operation || !isCurrent()) return;
    const completed = Promise.withResolvers<undefined>();
    pendingReconciliations.set(videoId, completed.promise);
    const targetIsDeletion = snapshot.deletionVideo?.videoId === videoId;
    try {
      if (!targetIsDeletion) setPhase("processing");
      const result = await reconcileVideo({ videoId });
      if (revision !== operation || !isCurrent()) return;
      if (targetIsDeletion) {
        if (result.kind === "ready" && isDeletionState(result.value.state)) {
          setDeletionVideo(result.value);
        }
        return;
      }
      applyVideoResult(result);
    } finally {
      pendingReconciliations.delete(videoId);
      completed.resolve(undefined);
      if (isCurrent())
        refreshPolling(targetIsDeletion ? "deletion" : "processing");
    }
  };

  // Runs after a request resolves, so the selection comes from the latest render, not the closure.
  const detachReplacedUpload = (
    replaced: MaterialAuthoringVideo | null,
    startedVideoId: string,
  ) => {
    const {
      deleteVideoId: currentDeleteVideoId,
      primaryVideo: currentPrimary,
    } = selection;
    const detachedVideoId = replacedUploadToDetach({
      primaryVideoId: currentPrimary?.videoId ?? null,
      replaced,
      startedVideoId,
    });
    if (detachedVideoId !== null)
      selection.onChange(currentPrimary, currentDeleteVideoId, detachedVideoId);
  };

  const performUpload = async (file: File) => {
    const revision = ++operation;
    const { access, materialId } = selection;
    if (materialId === null) return;
    const replaced = snapshot.video;
    setPhase("uploading");
    setRecoveredVideoId(null);
    setProgress(0);
    const browserAttempt = await getOrCreateBrowserVideoUploadAttempt(
      materialId,
      file,
    );
    uploadAttempt = browserAttempt;
    const initialized = await uploadVideo({
      access,
      byteSize: file.size,
      filename: file.name,
      materialId,
      submissionId: browserAttempt.submissionId,
      title: file.name.replace(/\.[^.]+$/u, ""),
    });
    if (revision !== operation) return;
    if (initialized.kind !== "ready") {
      if (initialized.kind === "upload_not_authorized") {
        clearBrowserVideoUploadAttempt(browserAttempt);
        uploadAttempt = null;
      }
      setPhase(initialized.kind === "unavailable" ? "error" : initialized.kind);
      return;
    }
    uploadAttempt = {
      ...browserAttempt,
      videoId: initialized.value.video.videoId,
    };
    recordBrowserVideoUploadAttempt(
      browserAttempt,
      initialized.value.video.videoId,
    );
    detachReplacedUpload(replaced, initialized.value.video.videoId);
    setVideo(initialized.value.video);
    if (
      new URL(initialized.value.uploadEndpoint).hostname.endsWith(".invalid")
    ) {
      setProgress(100);
      await reconcile(initialized.value.video.videoId);
      return;
    }
    const lifetime = new AbortController();
    uploadLifetime = lifetime;
    const transfer = startResumableVideoUpload({
      signal: lifetime.signal,
      file,
      onError: () => {
        if (revision !== operation) return;
        setPhase("error");
      },
      onProgress: (sent, total) => {
        if (revision !== operation) return;
        setProgress(Math.round((sent / total) * 100));
      },
      onSuccess: () => {
        if (revision !== operation) return;
        void reconcile(initialized.value.video.videoId);
      },
      uploadUrl: initialized.value.uploadEndpoint,
    });
    uploadTransfer = transfer;
    await transfer;
  };

  const attach = async () => {
    const revision = ++operation;
    const { access, materialId } = selection;
    if (materialId === null) return;
    const replaced = snapshot.video;
    setPhase("processing");
    const result = await attachVideo({
      access,
      materialId,
      providerVideoId: snapshot.providerVideoId,
    });
    if (revision !== operation) return;
    if (result.kind === "ready")
      detachReplacedUpload(replaced, result.value.videoId);
    applyVideoResult(result);
  };

  function refreshPolling(force?: "processing" | "deletion") {
    if (listeners.size === 0) {
      cancelPolling();
      return;
    }
    const ensure = (
      current: Poll | null,
      inputs: readonly unknown[],
      videoId: string | null,
      forced: boolean,
    ): Poll => {
      if (
        !forced &&
        current !== null &&
        inputs.every((value, index) => value === current.inputs[index])
      )
        return current;
      current?.cancel();
      let active = true;
      const timer =
        videoId === null
          ? undefined
          : window.setTimeout(() => {
              void reconcile(videoId, () => active);
            }, VIDEO_RECONCILIATION_POLL_INTERVAL_MILLISECONDS);
      return {
        inputs,
        cancel: () => {
          active = false;
          window.clearTimeout(timer);
        },
      };
    };
    const processing =
      snapshot.video !== null &&
      awaitsReconciliation({
        materialId: selection.materialId,
        phase: snapshot.phase,
        video: snapshot.video,
      })
        ? snapshot.video.videoId
        : null;
    processingPoll = ensure(
      processingPoll,
      [
        selection.materialId,
        snapshot.phase,
        snapshot.video,
        snapshot.recoveredVideoId,
        selection.deleteVideoId,
        snapshot.deletionVideo?.videoId,
      ],
      processing,
      force === "processing",
    );
    const deletion =
      snapshot.deletionVideo?.state === "deletion_requested" ||
      snapshot.deletionVideo?.state === "deleting"
        ? snapshot.deletionVideo.videoId
        : null;
    deletionPoll = ensure(
      deletionPoll,
      [
        snapshot.deletionVideo,
        snapshot.recoveredVideoId,
        selection.deleteVideoId,
      ],
      deletion,
      force === "deletion",
    );
  }
  const stopUpload = () => {
    operation += 1;
    uploadLifetime?.abort();
    uploadLifetime = null;
    const ending = uploadTransfer;
    uploadTransfer = null;
    void ending
      ?.then((transfer) => transfer?.abort(false))
      .catch(() => undefined);
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    subscribe(listener: () => void, nextSelection: VideoAuthoringSelection) {
      if (selection.materialId !== nextSelection.materialId) stopUpload();
      const deletionChanged =
        selection.latestVideoDeletion !== nextSelection.latestVideoDeletion;
      selection = nextSelection;
      listeners.add(listener);
      if (deletionChanged) setDeletionVideo(selection.latestVideoDeletion);
      refreshPolling();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) cancelPolling();
      };
    },
    stopUpload,
    setProviderVideoId: (providerVideoId: string) => {
      patch({ providerVideoId });
    },
    upload: async (file: File) => {
      const revision = operation + 1;
      try {
        await performUpload(file);
      } catch {
        if (revision === operation) setPhase("error");
      }
    },
    attach,
    reconcile: () => {
      const activeVideo = snapshot.video ?? selection.primaryVideo;
      if (activeVideo !== null) void reconcile(activeVideo.videoId);
    },
    deleteOwned: async () => {
      const activeVideo = snapshot.video ?? selection.primaryVideo;
      if (activeVideo === null) return;
      operation += 1;
      const transfer = await uploadTransfer;
      uploadTransfer = null;
      uploadLifetime = null;
      await transfer?.abort(true).catch(() => undefined);
      if (uploadAttempt?.videoId === activeVideo.videoId) {
        clearBrowserVideoUploadAttempt(uploadAttempt);
        uploadAttempt = null;
      }
      const retainedVideo =
        selection.primaryVideo?.videoId === activeVideo.videoId
          ? null
          : selection.primaryVideo;
      setDeletionVideo(activeVideo);
      setVideo(retainedVideo);
      setRecoveredVideoId(null);
      setPhase(phaseForVideo(retainedVideo));
      selection.onChange(retainedVideo, activeVideo.videoId, null);
    },
    remove: () => {
      const activeVideo = snapshot.video ?? selection.primaryVideo;
      stopUpload();
      if (uploadAttempt) clearBrowserVideoUploadAttempt(uploadAttempt);
      if (activeVideo !== null && selection.materialId !== null)
        clearBrowserVideoUploadAttemptsForVideo(
          selection.materialId,
          activeVideo.videoId,
        );
      uploadAttempt = null;
      setVideo(null);
      setRecoveredVideoId(null);
      setPhase("idle");
      selection.onChange(null, null, activeVideo?.videoId ?? null);
    },
    retryDeletion: () => {
      if (snapshot.deletionVideo === null) return;
      const target = snapshot.deletionVideo;
      const revision = operation;
      const deletionRevision = deletionFactsRevision;
      void retryDeletion({ videoId: target.videoId }).then((result) => {
        if (
          revision !== operation ||
          deletionFactsRevision !== deletionRevision
        )
          return;
        applyVideoResult(result);
      });
    },
  };
}
function isDeletionState(state: MaterialVideo["state"]): boolean {
  return (
    state === "deletion_requested" ||
    state === "deleting" ||
    state === "deleted" ||
    state === "delete_failed"
  );
}
