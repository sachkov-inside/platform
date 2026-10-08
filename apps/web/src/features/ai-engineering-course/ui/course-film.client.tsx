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
  const time = useRef(FILM_POSTER_TIME);
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
      drawFilm(g, time.current, fonts, palette);
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
      time.current = (time.current + (now - last) / 1000) % FILM_DURATION;
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
    time.current = FILM_POSTER_TIME;
    started.current = false;
    paintRef.current?.();
  }, [playing, ready]);

  return (
    <div className="aie-film">
      <canvas aria-label={FILM_DESCRIPTION} ref={canvas} role="img" />
    </div>
  );
}
