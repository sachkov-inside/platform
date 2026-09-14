"use client";

import { type CSSProperties, useEffect, useRef } from "react";

import { mountProcessArtwork, PROCESS_ARTWORK_TIME_SCALE, PROCESS_ARTWORK_TRANSITION_MS, type ProcessArtworkOptions } from "./process-artwork-clock";
import { ProcessArtworkScenes } from "./process-artwork-scenes";

import "./ai-first-process-artwork.css";

export function AiFirstProcessArtwork({ mode = "animated", scene = 5, loop = true }: Partial<ProcessArtworkOptions>) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return host.current ? mountProcessArtwork(host.current, { mode, scene, loop }) : undefined;
  }, [mode, scene, loop]);
  return <div className="ai-process-artwork" style={{ "--time-scale": PROCESS_ARTWORK_TIME_SCALE, "--scene-transition": `${String(PROCESS_ARTWORK_TRANSITION_MS)}ms` } as CSSProperties} ref={host}><ProcessArtworkScenes /></div>;
}
