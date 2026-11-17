import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";

/** Real vendor SDK; the replaceable service is only the external iframe document. */
export async function installVideoProvider(
  page: Page,
  options: {
    readonly failFirstPlay?: boolean;
    readonly metadata?: "zero" | "held";
  } = {},
) {
  const script = await readFile(
    resolve("test/navigation/video-provider/iframe.player-2.202.2.js.txt"),
  );
  if (
    createHash("sha256").update(script).digest("hex") !==
    "aa0975dfeb310809a5000d8d091df2b33623ff70a69dbccf8a48acb523fe8e58"
  )
    throw new Error("Kinescope SDK artifact digest mismatch");
  await page.route(
    "https://player.kinescope.io/latest/iframe.player.js*",
    (route) =>
      route.fulfill({ contentType: "application/javascript", body: script }),
  );
  let documents = 0;
  await page.route("https://kinescope.io/embed/**", (route) => {
    documents += 1;
    return route.fulfill({
      contentType: "text/html",
      body: providerDocument(
        options.failFirstPlay === true && documents === 1,
        documents === 1 ? options.metadata : undefined,
      ),
    });
  });
  await page.addInitScript(() => {
    let players = 0;
    window.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        event.origin !== "https://kinescope.io" ||
        typeof data !== "object" ||
        data === null ||
        !("type" in data) ||
        data.type !== "video-provider-observation"
      )
        return;
      const frame = [...document.querySelectorAll("iframe")].find(
        (candidate) => candidate.contentWindow === event.source,
      );
      if (frame === undefined) return;
      if ("ready" in data && data.ready === true) {
        players += 1;
        frame.dataset["player"] = String(players);
      }
      if ("durationReads" in data && typeof data.durationReads === "number") {
        frame.dataset["durationRequested"] = "true";
        frame.dataset["durationReads"] = String(data.durationReads);
      }
      if ("position" in data && typeof data.position === "number") {
        frame.dataset["position"] = String(data.position);
        frame.dataset["seekSeconds"] = String(data.position);
      }
      if ("playing" in data && typeof data.playing === "boolean")
        frame.dataset["playing"] = String(data.playing);
      if ("volume" in data && typeof data.volume === "number")
        frame.dataset["volume"] = String(data.volume);
      if ("rate" in data && typeof data.rate === "number")
        frame.dataset["rate"] = String(data.rate);
      window.dispatchEvent(
        new CustomEvent("video-provider-observation", { detail: data }),
      );
    });
  });
}

function providerDocument(
  failFirstPlay: boolean,
  metadata: "zero" | "held" | undefined,
) {
  return `<!doctype html><title>Synthetic external video</title><script>
  const uid = "synthetic-external-video";
  let port, playerId, failed = false, volume = 1, rate = 1, muted = false, duration = ${String(metadata === undefined ? 600 : 0)}, durationReads = 0;
  const durationRequests = [];
  const observe = data => parent.postMessage({ type: "video-provider-observation", ...data }, "*");
  const emit = (type, data = {}) => port?.postMessage({ type: "@@_KINESCOPE_PLAYER_EVENT", playerId, event: { type, data } });
  window.addEventListener("message", event => {
    if (event.source !== parent) return;
    const data = event.data;
    if (data?.type === "@_IFRAME_PING") parent.postMessage({ type: "@_IFRAME_PING", uid }, "*");
    if (data?.type === "@_IFRAME_HOST_READY") {
      playerId = data.data.playerId;
      const channel = new MessageChannel(); port = channel.port1;
      port.onmessage = ({ data: request }) => {
        if (request.type !== "KINESCOPE_PLAYER_CALL_METHOD") return;
        const { method, params, id } = request;
        if (method === "play" && ${String(failFirstPlay)} && !failed) {
          failed = true;
          port.postMessage({ type: "KINESCOPE_PLAYER_CALL_METHOD_ERROR", playerId, id, method, error: "Playback rejected" }); return;
        }
        let result;
        if (method === "getDuration") {
          observe({ durationReads: ++durationReads });
          if (${String(metadata === "held")}) { durationRequests.push(request); return; }
          result = duration;
        }
        if (method === "seekTo") observe({ position: params[0] });
        if (method === "play") { observe({ playing: true }); emit("play"); }
        if (method === "setVolume") { volume = params[0]; observe({ volume }); }
        if (method === "setPlaybackRate") { rate = params[0]; observe({ rate }); }
        if (method === "mute") muted = true;
        if (method === "unmute") muted = false;
        port.postMessage({ type: "KINESCOPE_PLAYER_CALL_METHOD_RESULT", playerId, id, method, result });
      };
      port.start();
      parent.postMessage({ type: "@_IFRAME_CLIENT_READY", uid, data: { viewableTracking: false } }, "*", [channel.port2]);
      observe({ ready: true, volume, rate });
    }
    if (data?.type === "video-provider-stimulus") {
      if (data.event === "metadata") {
        if (data.phase === "duration") duration = 600;
        emit(data.phase === "duration" ? "durationchange" : data.phase === "error" ? "fatalerror" : data.phase);
        if (data.phase === "error") for (const request of durationRequests.splice(0)) port.postMessage({ type: "KINESCOPE_PLAYER_CALL_METHOD_RESULT", playerId, id: request.id, method: request.method, result: 0 });
      }
      else if (data.event === "preferences") { volume = data.volume; rate = data.rate; emit("volumechange", { volume, muted }); emit("playbackratechange", { playbackRate: rate }); }
      else emit(data.event === "error" ? "fatalerror" : data.event, { currentTime: data.currentTime ?? 0 });
    }
  });
  parent.postMessage({ type: "@_IFRAME_PING", uid }, "*");
  </script>`;
}
