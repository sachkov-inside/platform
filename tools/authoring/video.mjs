import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { fileChecksum } from "./package.mjs";
import { withJournal } from "./journal.mjs";
import { parseLocalResponse } from "./local-boundaries.mjs";
import { localTransport, loopbackOrigin, resolveLocalTarget } from "./target.mjs";

// Real provider transfer needs an explicit owner approval for a concrete file and project.
export function transferRequired(uploadEndpoint) {
  return !new URL(uploadEndpoint).hostname.endsWith(".invalid");
}

/**
 * Uploads one finished recording for a synchronized Material and waits until the video is ready.
 * The upload receipt is keyed by Material and file checksum; the next local sync saves it with the
 * original's chapters. The idempotency key is persisted before the first call, so a retry never
 * starts a second upload.
 */
export async function uploadVideo({ stateDirectory, origin = resolveLocalTarget("editor"), sourceId, file, title, request: transport, sleep = delay, attempts = 40 }) {
  const target = loopbackOrigin(origin);
  const send = transport ?? localTransport(target);
  const request = async (path, body, key, options) => parseLocalResponse(path, await send(path, body, key, options));
  const environment = await request("/authoring/import/materials/environment");
  if (environment.mode !== "development") throw new Error("Video intake requires a development runtime");
  const path = resolve(file);
  const [info, sha256] = await Promise.all([stat(path), fileChecksum(path)]);
  if (!info.isFile() || info.size === 0) throw new Error(`Recording is not a finished file: ${path}`);
  return withJournal(stateDirectory, target, async ({ journal, persist }) => {
    journal.resources ??= {};
    const material = journal.materials[sourceId];
    if (!material || material.archived) throw new Error(`Synchronize ${sourceId} before attaching its recording`);
    const receiptKey = `upload:${material.materialId}:${sha256}`;
    let receipt = journal.resources[receiptKey];
    if (receipt === undefined) {
      receipt = { sourceId, idempotencyKey: `video-upload:${randomUUID()}`, byteSize: info.size, filename: basename(path), title: title ?? basename(path), access: material.access ?? "membership", phase: "initializing" };
      journal.resources[receiptKey] = receipt; await persist();
    }
    if (receipt.phase === "initializing") {
      let initialized;
      try {
        initialized = await request(`/authoring/materials/${material.materialId}/videos/uploads`, { access: receipt.access, byteSize: receipt.byteSize, filename: receipt.filename, title: receipt.title }, receipt.idempotencyKey);
      } catch (error) {
        if (error.body?.code === "upload_outcome_unknown") throw new Error(`Upload outcome for ${sourceId} is unknown; inspect the attempt before retrying (key ${receipt.idempotencyKey})`, { cause: error });
        throw error;
      }
      receipt = { ...receipt, phase: "transfer", videoId: initialized.video.videoId, providerVideoId: initialized.providerVideoId, uploadEndpoint: initialized.uploadEndpoint };
      journal.resources[receiptKey] = receipt; await persist();
    }
    if (receipt.phase === "transfer") {
      if (transferRequired(receipt.uploadEndpoint)) {
        throw new Error("This runtime needs a real provider transfer; it is not enabled without a separate owner approval");
      }
      receipt = { ...receipt, phase: "processing" };
      journal.resources[receiptKey] = receipt; await persist();
    }
    for (let attempt = 0; receipt.phase !== "ready"; attempt++) {
      if (attempt >= attempts) throw new Error(`Video for ${sourceId} is still processing; rerun the same command later`);
      if (attempt > 0) await sleep(3000);
      const video = await request(`/authoring/videos/${receipt.videoId}/reconcile`, {}, undefined, { method: "POST" });
      if (video.state === "failed" || video.state.startsWith("delet")) throw new Error(`Video for ${sourceId} is ${video.state}`);
      if (video.state === "ready") {
        receipt = { ...receipt, phase: "ready", durationSeconds: video.durationSeconds ?? null };
        journal.resources[receiptKey] = receipt;
        journal.resources[`source-video:${sourceId}`] = { videoId: receipt.videoId, providerVideoId: receipt.providerVideoId, sha256 };
        await persist();
      }
    }
    return { sourceId, materialId: material.materialId, videoId: receipt.videoId, providerVideoId: receipt.providerVideoId, durationSeconds: receipt.durationSeconds };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const option = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1]; };
  const [command] = args;
  const stateDirectory = option("--state");
  const sourceId = option("--source");
  const file = option("--file");
  if (command !== "upload" || !stateDirectory || !sourceId || !file) {
    throw new Error("Usage: pnpm authoring:video upload --state STATE_DIRECTORY --source inside-content:MATERIAL_ID --file RECORDING [--title TITLE] [--target editor|stand]");
  }
  const result = await uploadVideo({ stateDirectory, sourceId, file, title: option("--title"), origin: resolveLocalTarget(option("--target") ?? "editor") });
  process.stdout.write(`${JSON.stringify({ ...result, next: `Record platform_video.kinescope_id: ${result.providerVideoId} in the original, commit it and run the local sync` }, null, 2)}\n`);
}
