"use client";

import { useEffect, useRef } from "react";

import { mountProcessArtwork, type ProcessArtworkOptions } from "./process-artwork-clock";
import { ProcessArtworkScenes } from "./process-artwork-scenes";

import "./ai-first-process-artwork.css";

export function AiFirstProcessArtwork({ mode = "animated", scene = 5, loop = false }: Partial<ProcessArtworkOptions>) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    return host.current ? mountProcessArtwork(host.current, { mode, scene, loop }) : undefined;
  }, [mode, scene, loop]);
  return <div className="ai-process-artwork" ref={host}><ProcessArtworkScenes /></div>;
}
