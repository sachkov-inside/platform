"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  DEFAULT_PALETTE,
  drawFilm,
  FILM_DESCRIPTION,
  FILM_DURATION,
  FILM_POSTER_TIME,
  FILM_WIDTH,
  type FilmFonts,
  type FilmPalette,
} from "../model/course-film";
import {
  drawFilmV2,
  FILM_V2_DESCRIPTION,
  FILM_V2_DURATION,
  FILM_V2_POSTER_TIME,
} from "../model/course-film-v2";

import "./course-film.css";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(reducedMotionQuery);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}
const readReducedMotion = () => window.matchMedia(reducedMotionQuery).matches;
/** Сервер не знает настройку читателя и отдаёт неподвижный итоговый кадр. */
const readServerReducedMotion = () => true;

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/**
 * Две версии фильма: вторая — путь фичи от задачи до релиза — показывается по умолчанию, первая —
 * навыки AI-инженера — по адресу с `?film=v1`, чтобы владелец мог сравнить их.
 */
interface Film {
  readonly draw: typeof drawFilm;
  readonly description: string;
  readonly duration: number;
  readonly poster: number;
}
const FILMS: Readonly<Record<"v1" | "v2", Film>> = {
  v1: {
    draw: drawFilm,
    description: FILM_DESCRIPTION,
    duration: FILM_DURATION,
    poster: FILM_POSTER_TIME,
  },
  v2: {
    draw: drawFilmV2,
    description: FILM_V2_DESCRIPTION,
    duration: FILM_V2_DURATION,
    poster: FILM_V2_POSTER_TIME,
  },
};
type FilmVersion = keyof typeof FILMS;
const subscribeNothing = () => () => undefined;
const readFilmVersion = (): FilmVersion =>
  new URLSearchParams(window.location.search).get("film") === "v1"
    ? "v1"
    : "v2";
const readServerFilmVersion = (): FilmVersion => "v2";

/** Цвета и моноширинный шрифт анимации — токены страницы, как у остального интерфейса. */
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

/**
 * Анимация курса AI Engineering на холсте. Кадр задаёт только время: `drawFilm` — чистая функция,
 * поэтому пауза и итоговый кадр не расходятся. Время идёт, только пока анимация видна и вкладка
 * открыта. Кнопки паузы нет по решению владельца (30.09.2026, platform#808): тому, кто просит
 * уменьшить движение, анимация показывает неподвижный итоговый кадр.
 */
export function CourseFilm({
  autoplay = true,
}: {
  readonly autoplay?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const version = useSyncExternalStore(
    subscribeNothing,
    readFilmVersion,
    readServerFilmVersion,
  );
  const film = FILMS[version];
  const filmRef = useRef<Film>(film);
  const time = useRef<number>(film.poster);
  useEffect(() => {
    filmRef.current = film;
  }, [film]);
  const paintRef = useRef<(() => void) | undefined>(undefined);
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    readServerReducedMotion,
  );
  const playing = autoplay && !reduced;
  const [visible, setVisible] = useState(false);
  const [ready, setReady] = useState(false);

  // Размер холста следует за слотом; шрифт берём у страницы, когда он загружен.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return undefined;
    let fonts: FilmFonts = { sans: "sans-serif", mono: MONO };
    let palette = readPalette(element);
    const paint = () => {
      const g = element.getContext("2d");
      if (!g) return;
      const dpr = Math.min(
        window.devicePixelRatio > 0 ? window.devicePixelRatio : 1,
        2,
      );
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (element.width !== Math.round(width * dpr)) {
        element.width = Math.round(width * dpr);
        element.height = Math.round(height * dpr);
      }
      const scale = (dpr * width) / FILM_WIDTH;
      g.setTransform(scale, 0, 0, scale, 0, 0);
      filmRef.current.draw(g, time.current, fonts, palette);
    };
    const resize = new ResizeObserver(paint);
    resize.observe(element);
    void document.fonts.ready.then(() => {
      const style = getComputedStyle(element);
      const utility = style.getPropertyValue("--font-utility").trim();
      fonts = { sans: style.fontFamily, mono: utility === "" ? MONO : utility };
      palette = readPalette(element);
      paint();
      setReady(true);
    });
    paintRef.current = paint;
    return () => {
      resize.disconnect();
      paintRef.current = undefined;
    };
  }, []);

  // Вне экрана и в скрытой вкладке анимация стоит.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return undefined;
    let inView = false;
    const sync = () => {
      setVisible(inView && !document.hidden);
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry?.isIntersecting ?? false;
      sync();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  // Первый показ с движением начинается с начала фильма, а не с итогового кадра.
  const started = useRef(false);
  useEffect(() => {
    if (!playing || !visible || !ready) return undefined;
    if (!started.current) {
      started.current = true;
      time.current = 0;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      time.current =
        (time.current + (now - last) / 1000) % filmRef.current.duration;
      last = now;
      paintRef.current?.();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
    };
  }, [playing, visible, ready]);

  // Без движения — всегда итоговый кадр, даже если reduced motion включили посреди проигрывания.
  // Если движение вернут, фильм начнётся заново.
  useEffect(() => {
    if (playing || !ready) return;
    time.current = filmRef.current.poster;
    started.current = false;
    paintRef.current?.();
  }, [playing, ready]);

  return (
    <div className="aie-film">
      <canvas aria-label={film.description} ref={canvas} role="img" />
    </div>
  );
}
