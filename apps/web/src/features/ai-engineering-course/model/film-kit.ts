/**
 * Общий набор анимаций курса: размер холста, цвета из токенов страницы, пружины и рисование
 * плашек, текста, галочек, курсора и логотипов агентов. Фильмы `course-film` (первая версия) и
 * `course-film-v2` рисуют свои сцены этими функциями.
 */

import { AGENT_LOGOS, type AgentId } from "./agent-logos";

export const FILM_WIDTH = 960;
export const FILM_HEIGHT = 640;

export interface FilmFonts {
  readonly sans: string;
  readonly mono: string;
}

/** Цвета берутся из токенов страницы; значения по умолчанию совпадают с публичной оболочкой. */
export interface FilmPalette {
  /** Окно анимации: `--primary`. */
  readonly ink: string;
  /** Текст на окне: `--secondary`. */
  readonly paper: string;
  readonly accent: string;
  /** Успех: `--callout-good`, на тёмном окне светлее. */
  readonly good: string;
}

export const DEFAULT_PALETTE: FilmPalette = {
  ink: "#202124",
  paper: "#f3f1ed",
  accent: "#c7461e",
  good: "#5fb07a",
};

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Выход с замедлением, как `--motion-ease-out` страницы. */
export const easeOut = (x: number) => 1 - (1 - clamp(x)) ** 3;
/** Появление элемента за `duration` секунд, начиная с `at`. */
export const appear = (s: number, at: number, duration = 0.45) =>
  easeOut((s - at) / duration);

/** Затухающая пружина 0 → 1 в замкнутой форме: значение зависит только от времени. */
export function spring(t: number, k = 170, d = 26): number {
  if (t <= 0) return 0;
  const w0 = Math.sqrt(k);
  const z = d / (2 * w0);
  if (z < 1) {
    const wd = w0 * Math.sqrt(1 - z * z);
    return (
      1 -
      Math.exp(-z * w0 * t) *
        (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t))
    );
  }
  return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
}

/** Значение с несколькими целями: по одной пружине на каждую смену, движение не рвётся. */
export function track(
  t: number,
  keys: readonly (readonly [number, number])[],
  k = 170,
  d = 26,
): number {
  let value = keys[0]?.[1] ?? 0;
  for (let i = 1; i < keys.length; i++) {
    const [at, to] = keys[i] ?? [0, 0];
    const from = keys[i - 1]?.[1] ?? 0;
    value += (to - from) * spring(t - at, k, d);
  }
  return value;
}

/* ---------- Рисование ---------- */

export const LEFT = 56;
export const RIGHT = FILM_WIDTH - 56;
export const INNER = RIGHT - LEFT;

export function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + radius, y);
  g.arcTo(x + w, y, x + w, y + h, radius);
  g.arcTo(x + w, y + h, x, y + h, radius);
  g.arcTo(x, y + h, x, y, radius);
  g.arcTo(x, y, x + w, y, radius);
  g.closePath();
}

/** Заливка с прозрачностью: токены могут быть в oklch, поэтому альфа задаётся отдельно. */
export function fill(g: CanvasRenderingContext2D, color: string, alpha = 1) {
  g.save();
  g.globalAlpha *= alpha;
  g.fillStyle = color;
  g.fill();
  g.restore();
}

export function text(
  g: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  color: string,
  family: string,
  {
    align = "left",
    alpha = 1,
  }: { align?: CanvasTextAlign; alpha?: number } = {},
) {
  g.save();
  g.globalAlpha *= alpha;
  g.font = `${String(weight)} ${String(size)}px ${family}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillText(value, x, y);
  g.restore();
}

export function width(
  g: CanvasRenderingContext2D,
  value: string,
  font: string,
) {
  g.font = font;
  return g.measureText(value).width;
}

export function check(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  p: number,
  color: string,
) {
  if (p <= 0) return;
  const a = [x - size * 0.5, y] as const;
  const b = [x - size * 0.15, y + size * 0.35] as const;
  const c = [x + size * 0.5, y - size * 0.35] as const;
  const first = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const second = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const drawn = (first + second) * clamp(p);
  g.save();
  g.strokeStyle = color;
  g.lineWidth = size * 0.16;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(a[0], a[1]);
  if (drawn <= first) {
    g.lineTo(lerp(a[0], b[0], drawn / first), lerp(a[1], b[1], drawn / first));
  } else {
    g.lineTo(b[0], b[1]);
    const k = (drawn - first) / second;
    g.lineTo(lerp(b[0], c[0], k), lerp(b[1], c[1], k));
  }
  g.stroke();
  g.restore();
}

/** Круглый значок с галочкой: результат шага готов. */
export function done(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  p: number,
  c: FilmPalette,
) {
  if (p <= 0) return;
  g.beginPath();
  g.arc(x, y, 20 * (0.7 + 0.3 * p), 0, Math.PI * 2);
  fill(g, c.good, p);
  check(g, x, y, 20, clamp((p - 0.3) / 0.7), c.ink);
}

/** Элемент появляется, поднимаясь на несколько пикселей. */
export function rise(g: CanvasRenderingContext2D, p: number, draw: () => void) {
  if (p <= 0) return;
  g.save();
  g.globalAlpha *= p;
  g.translate(0, 14 * (1 - p));
  draw();
  g.restore();
}

/** Курсор нарисован кодом: стрелка с тёмным контуром и кольцо нажатия. */
export function cursor(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  alpha: number,
  press: number,
  c: FilmPalette,
) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha *= alpha;
  if (press > 0 && press < 1) {
    g.save();
    g.strokeStyle = c.accent;
    g.lineWidth = 3;
    g.globalAlpha *= 1 - press;
    g.beginPath();
    g.arc(x, y, 8 + press * 30, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  const scale = 1 - 0.12 * Math.sin(Math.PI * clamp(press));
  g.translate(x, y);
  g.scale(scale * 1.35, scale * 1.35);
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(0, 26);
  g.lineTo(7, 20);
  g.lineTo(12, 31);
  g.lineTo(17, 29);
  g.lineTo(12, 18);
  g.lineTo(21, 18);
  g.closePath();
  g.fillStyle = "#ffffff";
  g.fill();
  g.strokeStyle = c.ink;
  g.lineWidth = 1.6;
  g.lineJoin = "round";
  g.stroke();
  g.restore();
}

const logoPaths = new Map<AgentId, Path2D>();
/** Логотип агента в цвете бренда, по центру `(x, y)`, шириной `size`. */
export function logo(
  g: CanvasRenderingContext2D,
  id: AgentId,
  x: number,
  y: number,
  size: number,
  alpha: number,
) {
  if (alpha <= 0 || size <= 0) return;
  const source = AGENT_LOGOS[id];
  let path = logoPaths.get(id);
  if (!path) {
    path = new Path2D(source.path);
    logoPaths.set(id, path);
  }
  g.save();
  g.globalAlpha *= alpha;
  g.translate(x - size / 2, y - size / 2);
  g.scale(size / 24, size / 24);
  const [first = "#000000", ...rest] = source.colors;
  if (rest.length === 0) g.fillStyle = first;
  else {
    const gradient = g.createLinearGradient(0, 0, 24, 24);
    for (const [i, color] of source.colors.entries())
      gradient.addColorStop(i / (source.colors.length - 1), color);
    g.fillStyle = gradient;
  }
  g.fill(path, source.fillRule);
  g.restore();
}
