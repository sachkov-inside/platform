export async function startResumableVideoUpload(input: {
  readonly file: File;
  readonly onError: () => void;
  readonly onProgress: (sent: number, total: number) => void;
  readonly onSuccess: () => void;
  readonly uploadUrl: string;
}): Promise<void> {
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
  } catch {
    input.onError();
  }
}
