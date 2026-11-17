"use client";

import {
  DEFAULT_PALETTE,
  FILM_WIDTH,
  FILM_HEIGHT,
  type FilmFonts,
  type FilmPalette,
} from "../model/film-kit";
import {
  drawFilmV3,
  FILM_V3_DESCRIPTION,
  FILM_V3_DURATION,
  FILM_V3_POSTER_TIME,
} from "../model/course-film-v3";

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

// Default v3 follows the owner’s 08.10.2026 choice; ?film=v1/v2 stay lazy (#2377).
interface Film {
  readonly draw: typeof drawFilmV3;
  readonly description: string;
  readonly duration: number;
  readonly poster: number;
}
const DEFAULT_FILM: Film = {
  draw: drawFilmV3,
  description: FILM_V3_DESCRIPTION,
  duration: FILM_V3_DURATION,
  poster: FILM_V3_POSTER_TIME,
};
export type FilmVersion = "v1" | "v2" | "v3";

async function loadAlternative(version: "v1" | "v2"): Promise<Film> {
  if (version === "v1") {
    const film = await import("../model/course-film");
    return {
      draw: film.drawFilm,
      description: film.FILM_DESCRIPTION,
      duration: film.FILM_DURATION,
      poster: film.FILM_POSTER_TIME,
    };
  }
  const film = await import("../model/course-film-v2");
  return {
    draw: film.drawFilmV2,
    description: film.FILM_V2_DESCRIPTION,
    duration: film.FILM_V2_DURATION,
    poster: film.FILM_V2_POSTER_TIME,
  };
}
function readPalette(element: HTMLElement): FilmPalette {
  const style = getComputedStyle(element);
  const token = (name: string, fallback: string) => {
    const value = style.getPropertyValue(name).trim();
    return value === "" ? fallback : value;
  };
  return {
    ink: token("--primary", DEFAULT_PALETTE.ink),
    paper: token("--secondary", DEFAULT_PALETTE.paper),
    accent: token("--accent", DEFAULT_PALETTE.accent),
    good: DEFAULT_PALETTE.good,
  };
}

interface FilmSelection {
  readonly version: FilmVersion;
  readonly description: string;
}
const DEFAULT_SELECTION: FilmSelection = {
  version: "v3",
  description: DEFAULT_FILM.description,
};
export const readServerFilmSelection = (): FilmSelection => DEFAULT_SELECTION;

// One Canvas lease owns its native resources, including late font/module completions (#2377).
function runFilmCanvas(
  element: HTMLCanvasElement,
  version: FilmVersion,
  autoplay: boolean,
  initialFilm: Film | undefined,
  onLoaded: (film: Film) => void,
) {
  let active = true;
  let film = initialFilm ?? DEFAULT_FILM;
  let selectedReady = initialFilm !== undefined;
  let time = film.poster;
  let started = false;
  let ready = false;
  let inView = false;
  let frame: number | undefined;
  let last = 0;
  let fonts: FilmFonts = { sans: "sans-serif", mono: MONO };
  let palette = readPalette(element);
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const paint = () => {
    if (!active) return;
    const g = element.getContext("2d");
    if (!g) return;
    const dpr = Math.min(
      window.devicePixelRatio > 0 ? window.devicePixelRatio : 1,
      2,
    );
    const width = element.clientWidth;
    const height = element.clientHeight;
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (element.width !== pixelWidth || element.height !== pixelHeight) {
      element.width = pixelWidth;
      element.height = pixelHeight;
    }
    // Preserve authored geometry on height-only resize (#2377).
    const scale = Math.min(pixelWidth / FILM_WIDTH, pixelHeight / FILM_HEIGHT);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // Cover fractional mobile edges before fitting the frame (#2377).
    g.fillStyle = palette.ink;
    g.fillRect(0, 0, pixelWidth, pixelHeight);
    g.setTransform(
      scale,
      0,
      0,
      scale,
      (pixelWidth - FILM_WIDTH * scale) / 2,
      (pixelHeight - FILM_HEIGHT * scale) / 2,
    );
    film.draw(g, time, fonts, palette);
  };

  const tick = (now: number) => {
    if (!active) return;
    time = (time + (now - last) / 1000) % film.duration;
    last = now;
    paint();
    frame = requestAnimationFrame(tick);
  };
  const syncPlayback = () => {
    if (!active) return;
    if (frame !== undefined) {
      cancelAnimationFrame(frame);
      frame = undefined;
    }
    if (!ready) return;
    const playing = autoplay && !motion.matches && selectedReady;
    if (!playing) {
      time = film.poster;
      started = false;
      paint();
    } else if (inView && !document.hidden) {
      if (!started) {
        started = true;
        time = 0;
      }
      last = performance.now();
      frame = requestAnimationFrame(tick);
    }
  };
  const resize = new ResizeObserver(paint);
  resize.observe(element);
  const intersection = new IntersectionObserver(([entry]) => {
    inView = entry?.isIntersecting ?? false;
    syncPlayback();
  });
  intersection.observe(element);
  document.addEventListener("visibilitychange", syncPlayback);
  motion.addEventListener("change", syncPlayback);
  void document.fonts.ready.then(() => {
    if (!active) return;
    const style = getComputedStyle(element);
    const utility = style.getPropertyValue("--font-utility").trim();
    fonts = { sans: style.fontFamily, mono: utility === "" ? MONO : utility };
    palette = readPalette(element);
    ready = true;
    paint();
    syncPlayback();
  });
  if (!selectedReady && version !== "v3") {
    void loadAlternative(version).then(
      (alternative) => {
        if (!active) return;
        film = alternative;
        selectedReady = true;
        time = film.poster;
        started = false;
        paint();
        onLoaded(alternative);
        syncPlayback();
      },
      () => {
        // A failed alternative keeps the stationary v3 poster (#2377).
      },
    );
  }
  return () => {
    active = false;
    if (frame !== undefined) cancelAnimationFrame(frame);
    resize.disconnect();
    intersection.disconnect();
    document.removeEventListener("visibilitychange", syncPlayback);
    motion.removeEventListener("change", syncPlayback);
  };
}

/** Canvas attachment and the active React subscription jointly own retained-page playback. */
export function createCourseFilmRenderer() {
  const listeners = new Set<() => void>();
  let loaded: { version: FilmVersion; film: Film } = {
    version: "v3",
    film: DEFAULT_FILM,
  };
  let selection = DEFAULT_SELECTION;
  let attachment:
    | { canvas: HTMLCanvasElement; version: FilmVersion; autoplay: boolean }
    | undefined;
  let stop: (() => void) | undefined;
  const publish = (version: FilmVersion, film: Film) => {
    if (
      selection.version === version &&
      selection.description === film.description
    )
      return;
    selection = { version, description: film.description };
    for (const listener of listeners) listener();
  };
  const connect = () => {
    if (stop !== undefined || attachment === undefined || listeners.size === 0)
      return;
    const { canvas, version, autoplay } = attachment;
    const film =
      version === "v3"
        ? DEFAULT_FILM
        : loaded.version === version
          ? loaded.film
          : undefined;
    publish(version, film ?? DEFAULT_FILM);
    stop = runFilmCanvas(canvas, version, autoplay, film, (alternative) => {
      loaded = { version, film: alternative };
      publish(version, alternative);
    });
  };
  const disconnect = () => {
    stop?.();
    stop = undefined;
  };
  return {
    readSelection: () => selection,
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);
      connect();
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) disconnect();
      };
    },
    attach(canvas: HTMLCanvasElement, version: FilmVersion, autoplay: boolean) {
      disconnect();
      const current = { canvas, version, autoplay };
      attachment = current;
      connect();
      return () => {
        if (attachment !== current) return;
        disconnect();
        attachment = undefined;
      };
    },
  };
}
