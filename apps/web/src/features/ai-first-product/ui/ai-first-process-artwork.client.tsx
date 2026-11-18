"use client";

import { type CSSProperties, useCallback } from "react";

import {
  mountProcessArtwork,
  PROCESS_ARTWORK_TIME_SCALE,
  PROCESS_ARTWORK_TRANSITION_MS,
  type ProcessArtworkOptions,
} from "./process-artwork-clock";
import { ProcessArtworkScenes } from "./process-artwork-scenes";

import "./ai-first-process-artwork.css";

const artworkTiming: CSSProperties & Record<`--${string}`, number | string> = {
  "--time-scale": PROCESS_ARTWORK_TIME_SCALE,
  "--scene-transition": `${String(PROCESS_ARTWORK_TRANSITION_MS)}ms`,
};

export function AiFirstProcessArtwork({
  mode = "animated",
  scene = 5,
  loop = true,
}: Partial<ProcessArtworkOptions>) {
  const host = useCallback(
    (element: HTMLDivElement | null) =>
      element === null
        ? undefined
        : mountProcessArtwork(element, { mode, scene, loop }),
    [mode, scene, loop],
  );
  return (
    <div className="ai-process-artwork" style={artworkTiming} ref={host}>
      <ProcessArtworkScenes />
    </div>
  );
}
