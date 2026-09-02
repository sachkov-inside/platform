export interface ResumableVideoUpload {
  abort(shouldTerminate?: boolean): Promise<void>;
}

export async function startResumableVideoUpload(input: {
  readonly file: File;
  readonly onError: () => void;
  readonly onProgress: (sent: number, total: number) => void;
  readonly onSuccess: () => void;
  readonly uploadUrl: string;
}): Promise<ResumableVideoUpload | null> {
  try {
    const tus = await import("tus-js-client");
    const transfer = new tus.Upload(input.file, {
      chunkSize: 8 * 1024 * 1024,
      onError: input.onError,
      onProgress: input.onProgress,
      onSuccess: input.onSuccess,
      removeFingerprintOnSuccess: true,
      retryDelays: [0, 1_000, 3_000, 5_000],
      storeFingerprintForResuming: true,
      uploadUrl: input.uploadUrl,
    });
    const previous = await transfer.findPreviousUploads();
    if (previous[0] !== undefined) transfer.resumeFromPreviousUpload(previous[0]);
    transfer.start();
    return { abort: (shouldTerminate) => transfer.abort(shouldTerminate) };
  } catch {
    input.onError();
    return null;
  }
}
