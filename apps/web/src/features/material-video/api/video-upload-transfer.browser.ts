export interface ResumableVideoUpload {
  abort(shouldTerminate?: boolean): Promise<void>;
}

export async function startResumableVideoUpload(input: {
  readonly file: File;
  readonly onError: () => void;
  readonly onProgress: (sent: number, total: number) => void;
  readonly onSuccess: () => void;
  readonly uploadUrl: string;
  readonly signal: AbortSignal;
}): Promise<ResumableVideoUpload | null> {
  try {
    const tus = await import("tus-js-client");
    const transfer = new tus.Upload(input.file, {
      chunkSize: 8 * 1024 * 1024,
      onBeforeRequest: () => {
        // start() may reach request acquisition after its owner already aborted the handle.
        if (input.signal.aborted)
          throw new Error("Video upload lifetime ended");
      },
      onError: input.onError,
      onProgress: input.onProgress,
      onSuccess: input.onSuccess,
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 1_000, 3_000, 5_000],
      storeFingerprintForResuming: true,
      uploadUrl: input.uploadUrl,
    });
    const previous = await transfer.findPreviousUploads();
    if (input.signal.aborted) {
      // The SDK and its storage may settle after Activity cleanup. Do not start that transfer.
      await transfer.abort(false);
      return null;
    }
    if (previous[0] !== undefined)
      transfer.resumeFromPreviousUpload(previous[0]);
    transfer.start();
    return { abort: (shouldTerminate) => transfer.abort(shouldTerminate) };
  } catch {
    input.onError();
    return null;
  }
}
