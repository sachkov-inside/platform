// @ts-check
import { randomUUID } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { fileChecksum } from "./package.mjs";
import { withJournal } from "./journal.mjs";
import {
  parseLocalResponse,
  parseReceipt,
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
// A part that fails is resent from the server's offset after each of these pauses, then the run stops.
const tusRetryDelaysMs = [1_000, 3_000, 5_000];
const tusHeadTimeoutMs = 30_000;
// One part on a slow uplink; the server keeps what arrived, so a timeout loses no progress.
const tusPatchTimeoutMs = 300_000;
const sha256Pattern = /^[0-9a-f]{64}$/u;
// The only provider that receives recording bytes; the backend checks the same domain (#1794).
const providerUploadHost = "kinescope.io";

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
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.hostname !== providerUploadHost &&
      !url.hostname.endsWith(`.${providerUploadHost}`))
  )
    throw new Error(
      `${target.id} returned an upload endpoint that is not a Kinescope HTTPS upload endpoint`,
    );
  return "tus";
}

/**
 * @param {Headers} headers
 * @param {string} name
 */
function byteCount(headers, name) {
  const value = headers.get(name);
  if (value === null || !/^\d+$/u.test(value))
    throw new Error(`The upload endpoint sent no valid ${name}`);
  return Number(value);
}

/**
 * Sends a finished file to a Tus 1.0.0 upload that already exists. The server's offset decides
 * where each part starts, so a repeated run continues where the last one stopped. The file is read
 * one part at a time; the endpoint itself is a credential and never appears in a message.
 *
 * @param {{
 *   endpoint: string;
 *   path: string;
 *   size: number;
 *   fetcher?: typeof fetch;
 *   sleep?: (milliseconds: number) => Promise<unknown>;
 *   onProgress?: (sent: number, total: number) => void;
 * }} options
 */
async function tusTransfer({
  endpoint,
  path,
  size,
  fetcher = fetch,
  sleep = delay,
  onProgress = () => {},
}) {
  const serverOffset = async () => {
    const response = await fetcher(endpoint, {
      method: "HEAD",
      redirect: "error",
      headers: { "tus-resumable": "1.0.0" },
      signal: AbortSignal.timeout(tusHeadTimeoutMs),
    });
    if (!response.ok)
      throw new Error(
        `The upload endpoint answered ${String(response.status)}; this attempt cannot continue`,
      );
    const length = byteCount(response.headers, "upload-length");
    if (length !== size)
      throw new Error(
        `The upload's Upload-Length ${String(length)} differs from the file size ${String(size)}; this attempt belongs to another file`,
      );
    const offset = byteCount(response.headers, "upload-offset");
    if (offset > size)
      throw new Error("The upload endpoint reports more bytes than the file");
    return offset;
  };
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(Math.min(tusChunkBytes, size));
    let offset = await serverOffset();
    let failures = 0;
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
        response = await fetcher(endpoint, {
          method: "PATCH",
          redirect: "error",
          headers: {
            "tus-resumable": "1.0.0",
            "upload-offset": String(offset),
            "content-type": "application/offset+octet-stream",
          },
          body: buffer.subarray(0, bytesRead),
          signal: AbortSignal.timeout(tusPatchTimeoutMs),
        });
      } catch (error) {
        // No HTTP answer: the connection dropped or the part timed out.
        if (
          !(error instanceof TypeError) &&
          !(error instanceof DOMException && error.name === "TimeoutError")
        )
          throw error;
      }
      // Tus answers 204; like the editor's tus-js-client, any success status is accepted.
      if (response?.ok) {
        await response.body?.cancel();
        const next = byteCount(response.headers, "upload-offset");
        if (next <= offset || next > size)
          throw new Error("The upload endpoint reported an impossible offset");
        offset = next;
        failures = 0;
        onProgress(offset, size);
        continue;
      }
      await response?.body?.cancel();
      // A definitive refusal other than an offset conflict or throttling will not change on retry.
      const status = response?.status;
      if (
        status !== undefined &&
        status < 500 &&
        ![408, 409, 423, 429].includes(status)
      )
        throw new Error(
          `The upload endpoint refused a part with ${String(status)}`,
        );
      const pause = tusRetryDelaysMs[failures++];
      if (pause === undefined)
        throw new Error(
          `The transfer stopped at ${String(offset)} of ${String(size)} bytes${status === undefined ? "" : ` (HTTP ${String(status)})`}; run the same command again to continue`,
        );
      await sleep(pause);
      offset = await serverOffset();
    }
  } finally {
    await file.close();
  }
}

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
}) {
  const target = authoringTarget(origin);
  if (expected === undefined && target.kind === "trusted")
    throw new Error(
      `Upload to ${target.name} needs --sha256 with the checksum of the accepted file`,
    );
  if (expected !== undefined && !sha256Pattern.test(expected))
    throw new Error("--sha256 must be 64 lowercase hex characters");
  const path = resolve(file);
  const [info, sha256] = await Promise.all([stat(path), fileChecksum(path)]);
  if (!info.isFile() || info.size === 0)
    throw new Error(`Recording is not a finished file: ${path}`);
  if (expected !== undefined && sha256 !== expected)
    throw new Error(
      `Recording SHA-256 ${sha256} differs from the expected ${expected}: ${path}`,
    );
  const send = transport ?? transportFor(target, accessToken);
  /** @type {import("./local-boundaries.mjs").LocalRequest} */
  const request = async (path, body, key, options) =>
    parseLocalResponse(path, await send(path, body, key, options));
  const environment = await request("/authoring/import/materials/environment");
  assertTargetEnvironment(target, environment.mode);
  return withJournal(
    stateDirectory,
    target.id,
    async ({ journal, persist }) => {
      const resources = (journal.resources ??= {});
      const material = journal.materials[sourceId];
      if (!material || material.archived)
        throw new Error(
          `Synchronize ${sourceId} before attaching its recording`,
        );
      const receiptKey = `upload:${material.materialId}:${sha256}`;
      let receipt = parseReceipt(uploadReceiptSchema, resources[receiptKey]);
      // A failed provider outcome is known, so the same file may start a fresh attempt.
      if (receipt?.phase === "failed") receipt = undefined;
      if (receipt === undefined) {
        receipt = {
          sourceId,
          idempotencyKey: `video-upload:${randomUUID()}`,
          byteSize: info.size,
          filename: basename(path),
          title: title ?? basename(path),
          access: material.access ?? "closed",
          phase: "initializing",
        };
        resources[receiptKey] = receipt;
        await persist();
      }
      if (receipt.phase === "initializing") {
        let initialized;
        try {
          initialized = await request(
            `/authoring/materials/${material.materialId}/videos/uploads`,
            {
              access: receipt.access,
              byteSize: receipt.byteSize,
              filename: receipt.filename,
              title: receipt.title,
            },
            receipt.idempotencyKey,
          );
        } catch (error) {
          if (failureBodyField(error, "code") === "upload_outcome_unknown")
            throw new Error(
              `Upload outcome for ${sourceId} is unknown; inspect the attempt before retrying (key ${receipt.idempotencyKey})`,
              { cause: error },
            );
          throw error;
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
            path,
            size: receipt.byteSize,
            ...(fetcher === undefined ? {} : { fetcher }),
            sleep,
            ...(onProgress === undefined ? {} : { onProgress }),
          });
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
}

const usage =
  "Usage: pnpm authoring:video upload --target editor|stand|production --state STATE_DIRECTORY --source inside-content:MATERIAL_ID --file RECORDING [--sha256 HEX] [--title TITLE]\n       --sha256 is required for production; the same command continues an interrupted upload";

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
