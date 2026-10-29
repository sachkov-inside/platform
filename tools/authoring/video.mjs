// @ts-check
import { createHash, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { withJournal } from "./journal.mjs";
import {
  parseLocalResponse,
  parseReceipt,
  sourceVideoReceiptSchema,
  uploadReceiptKey,
  uploadReceiptSchema,
} from "./local-boundaries.mjs";
import { keychainStore, ownerSession } from "./credentials.mjs";
import {
  assertTargetEnvironment,
  authoringTarget,
  failureBodyField,
  transportFor,
} from "./target.mjs";

// Provider processing is polled at this interval until the Video is ready or terminal.
export const videoReconcileIntervalMs = 3_000;
// The editor's browser client sends the same part size to the provider's Tus endpoint.
export const tusChunkBytes = 8 * 1024 * 1024;
// A failed request is repeated after each of these pauses, from the server's offset; then the run stops.
export const tusRetryDelaysMs = [1_000, 3_000, 10_000, 30_000];
const tusVersion = "1.0.0";
// Besides 5xx, these answers say "not now" rather than "never" and are retried.
const tusRetryableStatuses = new Set([408, 409, 423, 429]);
// The provider no longer knows the upload; only the owner decides whether to start another one.
const tusExpiredStatuses = new Set([404, 410]);
const tusHeadTimeoutMs = 30_000;
// One part on a slow uplink; the server keeps what arrived, so a timeout loses no progress.
const tusPatchTimeoutMs = 300_000;
// The only provider that receives recording bytes; the backend checks the same domain (#1794).
const providerUploadHost = "kinescope.io";
const expectedChecksumSchema = z.hash("sha256").lowercase();
// A Tus byte count: a nonnegative safe integer in plain decimal digits.
const tusByteCount = z
  .string()
  .refine((value) => String(Number(value)) === value)
  .transform(Number)
  .pipe(z.int().nonnegative());
// HEAD answers both counts; PATCH answers the new offset.
const tusHeadersSchema = z.object({
  "upload-offset": tusByteCount,
  "upload-length": tusByteCount.optional(),
});

/**
 * @param {import("./local-boundaries.mjs").LocalRequest} request
 * @param {string} videoId
 * @param {{
 *   sleep?: (milliseconds: number) => Promise<unknown>;
 *   attempts: number;
 *   label: string;
 *   onState?: (video: import("./local-boundaries.mjs").Video) => Promise<void>;
 * }} options
 */
export async function waitUntilReady(
  request,
  videoId,
  { sleep = delay, attempts, label, onState = async () => {} },
) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(videoReconcileIntervalMs);
    const video = await request(
      `/authoring/videos/${videoId}/reconcile`,
      {},
      undefined,
      { method: "POST" },
    );
    await onState(video);
    if (video.state === "ready") return video;
    if (video.state === "failed" || video.state.startsWith("delet"))
      throw new Error(`${label}: video is ${video.state}`);
  }
  throw new Error(
    `${label}: video is still processing; rerun the same command later`,
  );
}

/** @param {URL} url */
const isProviderEndpoint = (url) =>
  url.protocol === "https:" &&
  url.username === "" &&
  url.password === "" &&
  (url.hostname === providerUploadHost ||
    url.hostname.endsWith(`.${providerUploadHost}`));

/**
 * How the bytes of an initialized upload reach the provider. The test adapter of a local runtime
 * answers with an `.invalid` endpoint that takes no bytes; every real transfer goes to Kinescope
 * over HTTPS, whichever target initialized it.
 *
 * @param {import("./target.mjs").AuthoringTarget} target
 * @param {string} uploadEndpoint
 * @returns {"none" | "tus"}
 */
function transferKind(target, uploadEndpoint) {
  const url = new URL(uploadEndpoint);
  if (target.kind === "local" && url.hostname.endsWith(".invalid"))
    return "none";
  if (!isProviderEndpoint(url))
    throw new Error(
      `${target.id} returned an upload endpoint that is not a Kinescope HTTPS upload endpoint`,
    );
  return "tus";
}

/**
 * The Tus byte counts of an answer; the endpoint's values stay unknown until parsed.
 *
 * @param {Response} response
 */
function tusHeaders(response) {
  const parsed = tusHeadersSchema.safeParse(
    Object.fromEntries(response.headers),
  );
  if (!parsed.success)
    throw new Error("The upload endpoint sent no valid Upload-Offset");
  return {
    offset: parsed.data["upload-offset"],
    length: parsed.data["upload-length"],
  };
}

/** @param {unknown} error fetch rejects so only when no HTTP answer arrived */
const isNetworkFailure = (error) =>
  error instanceof TypeError ||
  (error instanceof DOMException && error.name === "TimeoutError");

/** @param {number} status */
const isRetryable = (status) =>
  status >= 500 || tusRetryableStatuses.has(status);

/**
 * Sends a finished file to a Tus 1.0.0 upload that already exists. The server's offset decides
 * where each part starts, so a repeated run continues where the last one stopped. The file is read
 * one part at a time from the handle the checksum was computed through. The endpoint grants upload
 * access to this attempt, so no message names it.
 *
 * @param {{
 *   endpoint: string;
 *   file: import("node:fs/promises").FileHandle;
 *   size: number;
 *   attempt: { videoId: string; idempotencyKey: string };
 *   fetcher?: typeof fetch;
 *   sleep?: (milliseconds: number) => Promise<unknown>;
 *   onProgress?: (sent: number, total: number) => void;
 * }} options
 */
async function tusTransfer({
  endpoint,
  file,
  size,
  attempt,
  fetcher = fetch,
  sleep = delay,
  onProgress = () => {},
}) {
  /**
   * One Tus request. Like the editor's tus-js-client it follows a redirect, but only once and only
   * to another Kinescope HTTPS address; the same part is sent again there.
   *
   * @param {"HEAD" | "PATCH"} method
   * @param {Record<string, string>} headers
   * @param {Buffer<ArrayBuffer> | undefined} body
   * @param {number} timeoutMs
   */
  const tusRequest = async (method, headers, body, timeoutMs) => {
    let url = endpoint;
    for (let followed = false; ; followed = true) {
      const response = await fetcher(url, {
        method,
        redirect: "manual",
        headers: { "tus-resumable": tusVersion, ...headers },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status < 300 || response.status > 399) return response;
      await response.body?.cancel();
      const location = response.headers.get("location");
      const next =
        location !== null && URL.canParse(location, url)
          ? new URL(location, url)
          : undefined;
      if (followed || next === undefined || !isProviderEndpoint(next))
        throw new Error(
          `The upload endpoint redirected ${method} other than once to a Kinescope HTTPS address`,
        );
      url = next.href;
    }
  };
  /** @param {number} status */
  const expired = (status) =>
    new Error(
      `The provider upload of video ${attempt.videoId} (key ${attempt.idempotencyKey}) expired with HTTP ${String(status)}; this attempt cannot continue. Starting another upload is the owner's decision`,
    );
  let offset = 0;
  let failures = 0;
  /** Pauses before the next attempt, or stops the run once the budget is spent. @param {number | undefined} status */
  const retryOrStop = async (status) => {
    const pause = tusRetryDelaysMs[failures++];
    if (pause === undefined)
      throw new Error(
        `The transfer stopped at ${String(offset)} of ${String(size)} bytes${status === undefined ? "" : ` (HTTP ${String(status)})`}; run the same command again to continue`,
      );
    await sleep(pause);
  };
  const serverOffset = async () => {
    for (;;) {
      /** @type {Response} */
      let response;
      try {
        response = await tusRequest("HEAD", {}, undefined, tusHeadTimeoutMs);
      } catch (error) {
        if (!isNetworkFailure(error)) throw error;
        await retryOrStop(undefined);
        continue;
      }
      if (tusExpiredStatuses.has(response.status))
        throw expired(response.status);
      if (!response.ok) {
        if (!isRetryable(response.status))
          throw new Error(
            `The upload endpoint answered ${String(response.status)}; this attempt cannot continue`,
          );
        await retryOrStop(response.status);
        continue;
      }
      const head = tusHeaders(response);
      if (head.length === undefined)
        throw new Error("The upload endpoint sent no valid Upload-Length");
      if (head.length !== size)
        throw new Error(
          `The upload's Upload-Length ${String(head.length)} differs from the file size ${String(size)}; this attempt belongs to another file`,
        );
      if (head.offset > size)
        throw new Error("The upload endpoint reports more bytes than the file");
      return head.offset;
    }
  };
  const buffer = Buffer.alloc(Math.min(tusChunkBytes, size));
  offset = await serverOffset();
  onProgress(offset, size);
  while (offset < size) {
    const { bytesRead } = await file.read(
      buffer,
      0,
      Math.min(tusChunkBytes, size - offset),
      offset,
    );
    if (bytesRead === 0) throw new Error("The file became shorter");
    /** @type {Response | undefined} */
    let response;
    try {
      response = await tusRequest(
        "PATCH",
        {
          "upload-offset": String(offset),
          "content-type": "application/offset+octet-stream",
        },
        buffer.subarray(0, bytesRead),
        tusPatchTimeoutMs,
      );
    } catch (error) {
      // No HTTP answer: the connection dropped or the part timed out.
      if (!isNetworkFailure(error)) throw error;
    }
    // Tus answers 204; like the editor's tus-js-client, any success status is accepted.
    if (response?.ok) {
      await response.body?.cancel();
      const next = tusHeaders(response).offset;
      if (next <= offset || next > size)
        throw new Error("The upload endpoint reported an impossible offset");
      offset = next;
      failures = 0;
      onProgress(offset, size);
      continue;
    }
    await response?.body?.cancel();
    const status = response?.status;
    if (status !== undefined && tusExpiredStatuses.has(status))
      throw expired(status);
    if (status !== undefined && !isRetryable(status))
      throw new Error(
        `The upload endpoint refused a part with ${String(status)}`,
      );
    await retryOrStop(status);
    offset = await serverOffset();
  }
}

/**
 * The SHA-256 of a file, read through an open handle.
 *
 * @param {import("node:fs/promises").FileHandle} file
 * @param {number} size
 */
async function handleChecksum(file, size) {
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(Math.min(tusChunkBytes, size));
  for (let position = 0; position < size;) {
    const { bytesRead } = await file.read(
      buffer,
      0,
      Math.min(buffer.length, size - position),
      position,
    );
    if (bytesRead === 0) throw new Error("The file became shorter");
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  return hash.digest("hex");
}

/**
 * Stops when the file the handle reads is no longer the one that was hashed.
 *
 * @param {import("node:fs/promises").FileHandle} file
 * @param {import("node:fs").Stats} hashed
 * @param {string} path
 */
async function assertUnchanged(file, hashed, path) {
  const now = await file.stat();
  if (
    now.dev !== hashed.dev ||
    now.ino !== hashed.ino ||
    now.size !== hashed.size ||
    now.mtimeMs !== hashed.mtimeMs
  )
    throw new Error(
      `Recording ${path} changed while it was uploading; restore the accepted file and run the same command again`,
    );
}

/**
 * The stop of `--replace-public-upload` on a target that predates ADR 0041.
 *
 * @param {import("./target.mjs").AuthoringTarget} target
 * @param {string} videoId
 */
const unreportedProtection = (target, videoId) =>
  new Error(
    `${target.id} does not report whether video ${videoId} is protected; refresh it to a source with ADR 0041 and run the same command again`,
  );

/**
 * Uploads one finished recording for a synchronized Material and waits until the video is ready.
 * The upload receipt is keyed by Material and file checksum; the next release saves it with the
 * original's chapters. The idempotency key is persisted before the first call, so a retry never
 * starts a second upload, and an interrupted transfer continues from the provider's offset.
 * A trusted target needs the owner's session and the caller's checksum of the file.
 *
 * @param {object} options
 * @param {string} options.stateDirectory
 * @param {string} [options.origin] a local target name or loopback origin, or a trusted target
 * @param {string} options.sourceId
 * @param {string} options.file
 * @param {string | undefined} [options.title]
 * @param {string | undefined} [options.sha256] the checksum the caller expects of the file
 * @param {import("./target.mjs").LocalTransport} [options.request]
 * @param {import("./target.mjs").AccessToken | undefined} [options.accessToken]
 * @param {typeof fetch} [options.fetcher] reaches the provider's upload endpoint
 * @param {(milliseconds: number) => Promise<unknown>} [options.sleep]
 * @param {number} [options.attempts]
 * @param {(sent: number, total: number) => void} [options.onProgress]
 * @param {boolean} [options.replaceTestUpload] a local target uploads again a file the test adapter took
 * @param {boolean} [options.replacePublicUpload] a local target uploads again a file whose recording
 *   it reports outside the protected project
 */
export async function uploadVideo({
  stateDirectory,
  origin = "editor",
  sourceId,
  file,
  title,
  sha256: expected,
  request: transport,
  accessToken,
  fetcher,
  sleep = delay,
  attempts = 40,
  onProgress,
  replaceTestUpload = false,
  replacePublicUpload = false,
}) {
  const target = authoringTarget(origin);
  if (replaceTestUpload && target.kind === "trusted")
    throw new Error(
      `--replace-test-upload is only for local targets; ${target.name} never took a test-adapter upload`,
    );
  if (replacePublicUpload && target.kind === "trusted")
    throw new Error(
      `--replace-public-upload is only for local targets; ${target.name} keeps its recordings`,
    );
  if (expected === undefined && target.kind === "trusted")
    throw new Error(
      `Upload to ${target.name} needs --sha256 with the checksum of the accepted file`,
    );
  if (
    expected !== undefined &&
    !expectedChecksumSchema.safeParse(expected).success
  )
    throw new Error("--sha256 must be 64 lowercase hex characters");
  const path = resolve(file);
  // One handle gives the checksum, the size and every transferred byte, so all describe one file.
  const recording = await open(path, "r");
  try {
    const info = await recording.stat();
    if (!info.isFile() || info.size === 0)
      throw new Error(`Recording is not a finished file: ${path}`);
    const sha256 = await handleChecksum(recording, info.size);
    if (expected !== undefined && sha256 !== expected)
      throw new Error(
        `Recording SHA-256 ${sha256} differs from the expected ${expected}: ${path}`,
      );
    const send = transport ?? transportFor(target, accessToken);
    /** @type {import("./local-boundaries.mjs").LocalRequest} */
    const request = async (path, body, key, options) =>
      parseLocalResponse(path, await send(path, body, key, options));
    const environment = await request(
      "/authoring/import/materials/environment",
    );
    assertTargetEnvironment(target, environment.mode);
    return await withJournal(
      stateDirectory,
      target.id,
      async ({ journal, persist }) => {
        const resources = (journal.resources ??= {});
        const material = journal.materials[sourceId];
        if (!material || material.archived)
          throw new Error(
            `Synchronize ${sourceId} before attaching its recording`,
          );
        const receiptKey = uploadReceiptKey(material.materialId, sha256);
        let receipt = parseReceipt(uploadReceiptSchema, resources[receiptKey]);
        /**
         * Forgets an attempt, and the original's recording when it is this attempt's Video, so
         * the file uploads as new. The provider keeps the earlier recording.
         *
         * @param {string} discardedVideoId
         */
        const discard = (discardedVideoId) => {
          const attached = `source-video:${sourceId}`;
          if (
            parseReceipt(sourceVideoReceiptSchema, resources[attached])
              ?.videoId === discardedVideoId
          )
            delete resources[attached];
          delete resources[receiptKey];
        };
        // Only the test adapter's attempt, or one the target reports public, is discarded. Any
        // other receipt is continued as usual, so repeating the same command is safe.
        const stored =
          receipt !== undefined && "videoId" in receipt ? receipt : undefined;
        const testAdapter =
          stored !== undefined &&
          new URL(stored.uploadEndpoint).hostname.endsWith(".invalid");
        if (replaceTestUpload && stored !== undefined && testAdapter) {
          discard(stored.videoId);
          receipt = undefined;
        }
        if (
          replacePublicUpload &&
          stored !== undefined &&
          !testAdapter &&
          stored.phase !== "failed"
        ) {
          // The target's own record decides; the receipt's access predates ADR 0041 and says
          // nothing about the project a recording landed in.
          const video = await request(
            `/authoring/videos/${stored.videoId}/reconcile`,
            {},
            undefined,
            { method: "POST" },
          );
          if (video.protected === undefined)
            throw unreportedProtection(target, stored.videoId);
          if (!video.protected) {
            discard(stored.videoId);
            receipt = undefined;
          }
        }
        // A failed provider outcome is known, so the same file may start a fresh attempt.
        if (receipt?.phase === "failed") receipt = undefined;
        /** A new attempt, persisted before its first call. */
        const startAttempt = async () => {
          const started = {
            sourceId,
            idempotencyKey: `video-upload:${randomUUID()}`,
            byteSize: info.size,
            filename: basename(path),
            title: title ?? basename(path),
            access: material.access ?? "closed",
            phase: /** @type {const} */ ("initializing"),
          };
          resources[receiptKey] = started;
          await persist();
          return started;
        };
        /** @param {Awaited<ReturnType<typeof startAttempt>>} attempt */
        const initialize = async (attempt) => {
          try {
            return await request(
              `/authoring/materials/${material.materialId}/videos/uploads`,
              {
                access: attempt.access,
                byteSize: attempt.byteSize,
                filename: attempt.filename,
                title: attempt.title,
              },
              attempt.idempotencyKey,
            );
          } catch (error) {
            if (failureBodyField(error, "code") === "upload_outcome_unknown")
              throw new Error(
                `Upload outcome for ${sourceId} is unknown; inspect the attempt before retrying (key ${attempt.idempotencyKey})`,
                { cause: error },
              );
            throw error;
          }
        };
        receipt ??= await startAttempt();
        if (receipt.phase === "initializing") {
          let initialized = await initialize(receipt);
          // A target before ADR 0041 might have placed this attempt in the public project.
          if (replacePublicUpload && initialized.video.protected === undefined)
            throw unreportedProtection(target, initialized.video.videoId);
          // An attempt whose answer was lost replays as recorded, which before ADR 0041 may be
          // a public recording; only its answer names that Video.
          if (replacePublicUpload && !initialized.video.protected) {
            discard(initialized.video.videoId);
            receipt = await startAttempt();
            initialized = await initialize(receipt);
          }
          receipt = {
            ...receipt,
            phase: "transfer",
            videoId: initialized.video.videoId,
            providerVideoId: initialized.providerVideoId,
            uploadEndpoint: initialized.uploadEndpoint,
          };
          resources[receiptKey] = receipt;
          await persist();
        }
        if (receipt.phase === "transfer") {
          if (transferKind(target, receipt.uploadEndpoint) === "tus")
            await tusTransfer({
              endpoint: receipt.uploadEndpoint,
              attempt: receipt,
              file: recording,
              size: receipt.byteSize,
              ...(fetcher === undefined ? {} : { fetcher }),
              sleep,
              ...(onProgress === undefined ? {} : { onProgress }),
            });
          // The receipt stays in transfer, so the repeated command hashes the file again.
          await assertUnchanged(recording, info, path);
          receipt = { ...receipt, phase: "processing" };
          resources[receiptKey] = receipt;
          await persist();
        }
        if (receipt.phase !== "ready") {
          let video;
          try {
            video = await waitUntilReady(request, receipt.videoId, {
              sleep,
              attempts,
              label: sourceId,
            });
          } catch (error) {
            if (
              error instanceof Error &&
              /video is (failed|delet)/u.test(error.message)
            ) {
              resources[receiptKey] = { ...receipt, phase: "failed" };
              await persist();
            }
            throw error;
          }
          receipt = {
            ...receipt,
            phase: "ready",
            durationSeconds: video.durationSeconds ?? null,
          };
          resources[receiptKey] = receipt;
          resources[`source-video:${sourceId}`] = {
            videoId: receipt.videoId,
            providerVideoId: receipt.providerVideoId,
            sha256,
          };
          await persist();
        }
        return {
          sourceId,
          materialId: material.materialId,
          videoId: receipt.videoId,
          providerVideoId: receipt.providerVideoId,
          durationSeconds: receipt.durationSeconds,
          sha256,
        };
      },
    );
  } finally {
    await recording.close();
  }
}

const usage =
  "Usage: pnpm authoring:video upload --target editor|stand|production --state STATE_DIRECTORY --source inside-content:MATERIAL_ID --file RECORDING [--sha256 HEX] [--title TITLE] [--replace-test-upload] [--replace-public-upload]\n       --sha256 is required for production; the same command continues an interrupted upload\n       --replace-test-upload (local targets only) uploads again a file the test adapter took; any other upload continues as usual\n       --replace-public-upload (local targets only) uploads again a file whose recording the target reports outside the protected project; any other upload continues as usual";

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      state: { type: "string" },
      source: { type: "string" },
      file: { type: "string" },
      title: { type: "string" },
      sha256: { type: "string" },
      "replace-test-upload": { type: "boolean", default: false },
      "replace-public-upload": { type: "boolean", default: false },
      target: { type: "string", default: "editor" },
    },
  });
  if (
    positionals[0] !== "upload" ||
    positionals.length !== 1 ||
    !values.state ||
    !values.source ||
    !values.file
  ) {
    throw new Error(usage);
  }
  const target = authoringTarget(values.target);
  let reported = -1;
  const result = await uploadVideo({
    stateDirectory: values.state,
    sourceId: values.source,
    file: values.file,
    title: values.title,
    sha256: values.sha256,
    replaceTestUpload: values["replace-test-upload"],
    replacePublicUpload: values["replace-public-upload"],
    origin: target.id,
    accessToken:
      target.kind === "trusted"
        ? ownerSession(target, { store: keychainStore() })
        : undefined,
    // Whole percents on stderr, so stdout stays one JSON document.
    onProgress: (sent, total) => {
      const percent = Math.floor((sent / total) * 100);
      if (percent === reported) return;
      reported = percent;
      process.stderr.write(
        `Uploaded ${String(percent)}% (${String(sent)} of ${String(total)} bytes)\n`,
      );
    },
  });
  const next =
    target.kind === "trusted"
      ? `Preview the release with --target ${target.name} and the same --state; it attaches the ready upload. Optionally record platform_video.kinescope_id: ${result.providerVideoId} in the original`
      : `Record platform_video.kinescope_id: ${result.providerVideoId} in the original, commit it and run the local sync`;
  process.stdout.write(
    `${JSON.stringify({ target: target.id, ...result, next }, null, 2)}\n`,
  );
}
