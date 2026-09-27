// @ts-check
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
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
import {
  failureBodyField,
  localTransport,
  loopbackOrigin,
  resolveLocalTarget,
} from "./target.mjs";

// Provider processing is polled at this interval until the Video is ready or terminal.
export const videoReconcileIntervalMs = 3_000;

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
 * Real provider transfer needs an explicit owner approval for a concrete file and project.
 *
 * @param {string} uploadEndpoint
 */
export function transferRequired(uploadEndpoint) {
  return !new URL(uploadEndpoint).hostname.endsWith(".invalid");
}

/**
 * Uploads one finished recording for a synchronized Material and waits until the video is ready.
 * The upload receipt is keyed by Material and file checksum; the next local sync saves it with the
 * original's chapters. The idempotency key is persisted before the first call, so a retry never
 * starts a second upload.
 *
 * @param {object} options
 * @param {string} options.stateDirectory
 * @param {string} [options.origin]
 * @param {string} options.sourceId
 * @param {string} options.file
 * @param {string | undefined} [options.title]
 * @param {import("./target.mjs").LocalTransport} [options.request]
 * @param {(milliseconds: number) => Promise<unknown>} [options.sleep]
 * @param {number} [options.attempts]
 */
export async function uploadVideo({
  stateDirectory,
  origin = resolveLocalTarget("editor"),
  sourceId,
  file,
  title,
  request: transport,
  sleep = delay,
  attempts = 40,
}) {
  const target = loopbackOrigin(origin);
  const send = transport ?? localTransport(target);
  /** @type {import("./local-boundaries.mjs").LocalRequest} */
  const request = async (path, body, key, options) =>
    parseLocalResponse(path, await send(path, body, key, options));
  const environment = await request("/authoring/import/materials/environment");
  if (environment.mode !== "development")
    throw new Error("Video intake requires a development runtime");
  const path = resolve(file);
  const [info, sha256] = await Promise.all([stat(path), fileChecksum(path)]);
  if (!info.isFile() || info.size === 0)
    throw new Error(`Recording is not a finished file: ${path}`);
  return withJournal(stateDirectory, target, async ({ journal, persist }) => {
    const resources = (journal.resources ??= {});
    const material = journal.materials[sourceId];
    if (!material || material.archived)
      throw new Error(`Synchronize ${sourceId} before attaching its recording`);
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
        access: material.access ?? "membership",
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
      if (transferRequired(receipt.uploadEndpoint)) {
        throw new Error(
          "This runtime needs a real provider transfer; it is not enabled without a separate owner approval",
        );
      }
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
    };
  });
}

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
    throw new Error(
      "Usage: pnpm authoring:video upload --state STATE_DIRECTORY --source inside-content:MATERIAL_ID --file RECORDING [--title TITLE] [--target editor|stand]",
    );
  }
  const result = await uploadVideo({
    stateDirectory: values.state,
    sourceId: values.source,
    file: values.file,
    title: values.title,
    origin: resolveLocalTarget(values.target),
  });
  process.stdout.write(
    `${JSON.stringify({ ...result, next: `Record platform_video.kinescope_id: ${result.providerVideoId} in the original, commit it and run the local sync` }, null, 2)}\n`,
  );
}
