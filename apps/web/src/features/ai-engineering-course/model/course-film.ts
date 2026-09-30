/**
 * Анимация курса AI Engineering как чистая функция времени: `drawFilm(ctx, t)` рисует кадр для
 * любого момента без таймеров и накопленного состояния, поэтому пауза, шаг и итоговый кадр — это
 * просто разные `t`. Бриф и покадровый план — docs/evidence/issue-808/animation/README.md.
 */

export const FILM_WIDTH = 960;
export const FILM_HEIGHT = 640;
export const FILM_DURATION = 16;
/** Итоговый кадр: все задачи закрыты, релизы выпущены. Его видит reduced motion. */
export const FILM_POSTER_TIME = 15;

const INK = "#202124";
const PANEL = "#2b2c31";
const PANEL_HIGH = "#36373d";
const LINE = "rgba(243, 241, 237, 0.14)";
const TEXT = "#f3f1ed";
const MUTED = "rgba(243, 241, 237, 0.62)";
const ACCENT = "#c7461e";
const ACCENT_BRIGHT = "#ef6b3c";

export interface FilmFonts {
  readonly sans: string;
  readonly mono: string;
}

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

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

/** Сид-шум mulberry32: одинаковый в каждом прогоне. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let x = Math.imul(s ^ (s >>> 15), 1 | s);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Видимость сцены: вход пружиной, уход вверх с затуханием. */
function sceneAlpha(t: number, from: number, to: number) {
  return Math.min(clamp((t - from) / 0.2), clamp((to - t) / 0.22));
}
function sceneLift(t: number, to: number) {
  return -56 * clamp((t - (to - 0.22)) / 0.22);
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + radius, y);
  g.arcTo(x + w, y, x + w, y + h, radius);
  g.arcTo(x + w, y + h, x, y + h, radius);
  g.arcTo(x, y + h, x, y, radius);
  g.arcTo(x, y, x + w, y, radius);
  g.closePath();
}

/** Галочка рисуется штрихом: `p` — доля нарисованного пути. */
function check(
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

/** Агент — терракотовая точка с орбитой; орбита вращается от времени. */
function agent(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  t: number,
  scale = 1,
) {
  if (scale <= 0) return;
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  g.strokeStyle = "rgba(239, 107, 60, 0.45)";
  g.lineWidth = 3;
  g.beginPath();
  g.arc(0, 0, 30, t * 2.6, t * 2.6 + Math.PI * 1.35);
  g.stroke();
  g.fillStyle = ACCENT_BRIGHT;
  g.beginPath();
  g.arc(0, 0, 15 + Math.sin(t * 6) * 1.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = ACCENT_BRIGHT;
  g.beginPath();
  g.arc(Math.cos(t * 2.6) * 30, Math.sin(t * 2.6) * 30, 5, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function label(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  color: string,
  family: string,
  align: CanvasTextAlign = "left",
) {
  g.font = `${String(weight)} ${String(size)}px ${family}`;
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillText(text, x, y);
}

/* ---------- Сцена 1: AI-first и задача ---------- */
const PROMPT = "Добавь вход через GitHub";
/** Буквы заголовка по отдельности: каждая влетает на своей пружине. */
const TITLE_LETTERS = ["A", "I", "-", "f", "i", "r", "s", "t"] as const;
function sceneTask(g: CanvasRenderingContext2D, t: number, f: FilmFonts) {
  const a = sceneAlpha(t, 0, 2.7);
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;
  g.translate(0, sceneLift(t, 2.7));
  // Буквы влетают по одной снизу: заголовок собирается, а не проявляется.
  g.font = `800 132px ${f.sans}`;
  let letterX = 72;
  for (const [i, letter] of TITLE_LETTERS.entries()) {
    const p = spring(t - 0.04 - i * 0.05, 260, 20);
    const width = g.measureText(letter).width;
    if (p > 0) {
      g.save();
      g.globalAlpha = a * clamp(p * 1.6);
      g.translate(letterX, 250 + 70 * (1 - p));
      label(g, letter, 0, 0, 132, 800, i >= 3 ? ACCENT_BRIGHT : TEXT, f.sans);
      g.restore();
    }
    letterX += width;
  }
  const bar = spring(t - 0.5, 240, 26);
  g.fillStyle = ACCENT;
  g.fillRect(76, 322, 520 * bar, 12);

  const box = spring(t - 0.7, 200, 24);
  g.save();
  g.globalAlpha = a * box;
  g.translate(0, 40 * (1 - box));
  roundRect(g, 72, 390, 816, 104, 22);
  g.fillStyle = PANEL;
  g.fill();
  label(g, "›", 108, 442, 44, 700, ACCENT_BRIGHT, f.mono);
  const typed = Math.floor(clamp((t - 0.95) / 1.1) * PROMPT.length);
  label(g, PROMPT.slice(0, typed), 150, 442, 40, 600, TEXT, f.sans);
  g.font = `600 40px ${f.sans}`;
  const caretX = 150 + g.measureText(PROMPT.slice(0, typed)).width + 6;
  if (Math.floor(t * 3) % 2 === 0 || typed < PROMPT.length) {
    g.fillStyle = ACCENT_BRIGHT;
    g.fillRect(caretX, 420, 4, 44);
  }
  g.restore();
  // Задача дописана — агент просыпается в конце строки и принимает её.
  const wake = spring(t - 2.05, 240, 16);
  agent(g, 830, 442, t, wake);
  if (wake > 0) {
    g.save();
    g.globalAlpha = a * clamp(wake);
    label(g, "агент принял задачу", 888, 548, 30, 700, MUTED, f.sans, "right");
    g.restore();
  }
  g.restore();
}

/* ---------- Сцена 2: агент проходит этапы, код, тесты ---------- */
const STAGES = ["Спецификация", "Задачи", "Код", "Проверка"] as const;
const STAGE_AT = [2.9, 3.35, 3.8, 4.25] as const;
function sceneAgent(g: CanvasRenderingContext2D, t: number, f: FilmFonts) {
  const a = sceneAlpha(t, 2.45, 6.55);
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;
  g.translate(0, sceneLift(t, 6.55));

  // Задача сверху: это та же задача, что набиралась, теперь как карточка.
  const card = spring(t - 2.5, 220, 24);
  g.save();
  g.globalAlpha = a * card;
  g.translate(0, -20 * (1 - card));
  roundRect(g, 60, 56, 520, 76, 18);
  g.fillStyle = PANEL;
  g.fill();
  label(g, "Задача", 88, 94, 30, 700, ACCENT_BRIGHT, f.sans);
  label(g, PROMPT, 212, 94, 30, 600, TEXT, f.sans);
  g.restore();

  // Этапы в колонку слева, агент спускается вдоль них.
  g.font = `700 32px ${f.sans}`;
  for (const [i, name] of STAGES.entries()) {
    const at = STAGE_AT[i] ?? 0;
    const p = spring(t - at + 0.3, 260, 22);
    if (p <= 0) continue;
    const y = 190 + i * 96;
    const done = clamp((t - at - 0.2) / 0.3);
    g.save();
    g.globalAlpha = a * clamp(p * 1.3);
    g.translate(-30 * (1 - p), 0);
    roundRect(g, 130, y, 350, 74, 18);
    g.fillStyle = done > 0.5 ? PANEL_HIGH : PANEL;
    g.fill();
    if (done > 0) {
      g.strokeStyle = ACCENT;
      g.lineWidth = 2;
      roundRect(g, 130, y, 350, 74, 18);
      g.stroke();
    }
    label(g, name, 160, y + 37, 32, 700, TEXT, f.sans);
    check(g, 448, y + 37, 24, done, ACCENT_BRIGHT);
    g.restore();
  }
  const agentY = track(
    t,
    [[2.5, 227], ...STAGE_AT.map((at, i) => [at - 0.1, 227 + i * 96] as const)],
    160,
    22,
  );
  agent(g, 82, agentY, t, spring(t - 2.6, 220, 22));

  // Код справа: строки разной длины приходят по одной, затем штамп тестов.
  const panel = spring(t - 3.1, 200, 24);
  if (panel > 0) {
    g.save();
    g.globalAlpha = a * panel;
    g.translate(30 * (1 - panel), 0);
    roundRect(g, 520, 190, 380, 368, 20);
    g.fillStyle = PANEL;
    g.fill();
    const random = rng(17);
    for (let i = 0; i < 9; i++) {
      const at = 3.4 + i * 0.26;
      const lineP = clamp((t - at) / 0.18);
      const indent = [0, 1, 1, 2, 2, 1, 2, 1, 0][i] ?? 0;
      const width = (120 + random() * 170) * lineP;
      g.fillStyle = i % 4 === 2 ? "rgba(239, 107, 60, 0.75)" : LINE;
      roundRect(g, 552 + indent * 34, 222 + i * 34, width, 14, 7);
      g.fill();
    }
    const stamp = spring(t - 5.75, 260, 16);
    if (stamp > 0) {
      g.save();
      g.translate(710, 510);
      g.scale(0.6 + 0.4 * stamp, 0.6 + 0.4 * stamp);
      g.globalAlpha = a * clamp(stamp * 1.5);
      roundRect(g, -150, -34, 300, 68, 34);
      g.fillStyle = ACCENT;
      g.fill();
      check(g, -106, 0, 26, clamp((t - 5.85) / 0.25), TEXT);
      label(g, "тесты 24/24", -80, 1, 30, 700, TEXT, f.sans);
      g.restore();
    }
    g.restore();
  }
  g.restore();
}

/* ---------- Сцена 3: harness растёт — слои встают друг на друга ---------- */
const LAYERS = ["AGENTS.md", "skills", "MCP", "RAG", "evals"] as const;
const LAYER_AT = [6.8, 7.35, 7.9, 8.45, 9.0] as const;
function sceneHarness(g: CanvasRenderingContext2D, t: number, f: FilmFonts) {
  const a = sceneAlpha(t, 6.5, 10.55);
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;
  g.translate(0, sceneLift(t, 10.55));
  const title = spring(t - 6.55, 220, 22);
  g.save();
  g.globalAlpha = a * clamp(title * 1.3);
  g.translate(-40 * (1 - title), 0);
  label(g, "harness", 60, 250, 96, 800, TEXT, f.sans);
  g.fillStyle = ACCENT;
  g.fillRect(64, 318, 360 * spring(t - 6.8, 240, 26), 12);
  label(g, "растёт с каждой", 60, 390, 36, 600, MUTED, f.sans);
  label(g, "задачей", 60, 436, 36, 600, MUTED, f.sans);
  g.restore();

  // Башня справа: каждый новый слой падает сверху и встаёт на предыдущий.
  const x = 540;
  const w = 360;
  const h = 72;
  const gap = 10;
  const floor = 590;
  for (const [i, name] of LAYERS.entries()) {
    const at = LAYER_AT[i] ?? 0;
    const p = spring(t - at, 260, 20);
    if (p <= 0) continue;
    const y = floor - (i + 1) * (h + gap);
    g.save();
    g.globalAlpha = a * clamp(p * 2);
    g.translate(0, -180 * (1 - p));
    roundRect(g, x, y, w, h, 16);
    const top = i === LAYERS.length - 1;
    g.fillStyle = top ? ACCENT : PANEL_HIGH;
    g.fill();
    label(g, name, x + 28, y + h / 2, 34, 700, TEXT, f.mono);
    label(
      g,
      `0${String(i + 1)}`,
      x + w - 28,
      y + h / 2,
      28,
      700,
      top ? TEXT : MUTED,
      f.sans,
      "right",
    );
    g.restore();
  }
  g.fillStyle = LINE;
  g.fillRect(x - 20, floor + 4, w + 40, 3);
  // Агент всегда стоит на верхнем слое.
  const layerTop = track(
    t,
    [
      [6.6, floor - 20],
      ...LAYER_AT.map(
        (at, i) => [at + 0.08, floor - (i + 1) * (h + gap) - 24] as const,
      ),
    ],
    200,
    20,
  );
  agent(g, x + w / 2, layerTop, t, spring(t - 6.7, 220, 22) * 0.8);
  g.restore();
}

/* ---------- Сцена 4: много задач и релизы ---------- */
const TASKS = [
  "Вход",
  "Роли",
  "MCP",
  "RAG",
  "Поиск",
  "Evals",
  "Логи",
  "Бот",
  "Релиз",
] as const;
function sceneShip(g: CanvasRenderingContext2D, t: number, f: FilmFonts) {
  const a = sceneAlpha(t, 10.45, 15.65);
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;

  const cardW = 138;
  const cardH = 88;
  let done = 0;
  for (const [i, name] of TASKS.entries()) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 60 + col * (cardW + 14);
    const y = 150 + row * (cardH + 14);
    const p = spring(t - 10.5 - i * 0.06, 260, 20);
    if (p <= 0) continue;
    const closeAt = 11.0 + i * 0.2;
    const closed = clamp((t - closeAt) / 0.25);
    if (closed >= 1) done += 1;
    g.save();
    g.globalAlpha = a * clamp(p * 1.4);
    g.translate(x + cardW / 2, y + cardH / 2);
    g.scale(0.85 + 0.15 * p, 0.85 + 0.15 * p);
    roundRect(g, -cardW / 2, -cardH / 2, cardW, cardH, 16);
    g.fillStyle = closed >= 1 ? ACCENT : PANEL;
    g.fill();
    // Карточка в работе обведена: видно, какую задачу агент закрывает сейчас.
    const working = clamp((t - (closeAt - 0.35)) / 0.1) * (1 - closed);
    if (working > 0) {
      g.strokeStyle = ACCENT_BRIGHT;
      g.lineWidth = 3;
      g.globalAlpha = a * working;
      roundRect(g, -cardW / 2, -cardH / 2, cardW, cardH, 16);
      g.stroke();
      g.globalAlpha = a * clamp(p * 1.4);
    }
    label(g, name, -cardW / 2 + 16, -8, 30, 700, TEXT, f.sans);
    check(g, cardW / 2 - 26, 22, 22, closed, TEXT);
    g.restore();
  }
  // Три агента работают параллельно: стоят у счётчика, пока сетка закрывается.
  const leave = clamp((t - 13.2) / 0.3);
  for (let lane = 0; lane < 3; lane++) {
    const pop = spring(t - 10.7 - lane * 0.1, 240, 18) * (1 - leave);
    agent(g, 400 + lane * 52, 82, t + lane * 0.7, pop * 0.55);
  }
  // Счётчик закрытых задач.
  const counter = spring(t - 10.6, 220, 24);
  g.save();
  g.globalAlpha = a * counter;
  label(g, String(done), 60, 82, 72, 800, TEXT, f.sans);
  g.font = `800 72px ${f.sans}`;
  const numberW = g.measureText(String(done)).width;
  label(g, "задач закрыто", 60 + numberW + 18, 88, 32, 600, MUTED, f.sans);
  g.restore();

  // Релизы поднимаются справа.
  const chart = spring(t - 11.4, 200, 24);
  if (chart > 0) {
    g.save();
    g.globalAlpha = a * chart;
    g.translate(30 * (1 - chart), 0);
    roundRect(g, 540, 150, 360, 404, 22);
    g.fillStyle = PANEL;
    g.fill();
    label(g, "релизы", 568, 196, 32, 700, MUTED, f.sans);
    const points = [0, 1, 2, 3, 4].map((i) => ({
      x: 590 + i * 70,
      y: 490 - i * 58 - (i === 4 ? 14 : 0),
      at: 11.9 + i * 0.5,
    }));
    g.strokeStyle = "rgba(243, 241, 237, 0.2)";
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(570, 520);
    g.lineTo(880, 520);
    g.stroke();
    g.strokeStyle = ACCENT_BRIGHT;
    g.lineWidth = 5;
    g.lineCap = "round";
    g.beginPath();
    for (const [i, point] of points.entries()) {
      const next = points[i + 1];
      if (i === 0) g.moveTo(point.x, point.y);
      if (!next) break;
      const k = clamp((t - point.at) / (next.at - point.at));
      if (k <= 0) break;
      g.lineTo(lerp(point.x, next.x, k), lerp(point.y, next.y, k));
    }
    g.stroke();
    for (const [i, point] of points.entries()) {
      const p = spring(t - point.at, 280, 16);
      if (p <= 0) continue;
      const last = i === points.length - 1;
      g.fillStyle = last ? ACCENT_BRIGHT : TEXT;
      g.beginPath();
      g.arc(point.x, point.y, (last ? 14 : 9) * p, 0, Math.PI * 2);
      g.fill();
      if (last) {
        label(
          g,
          `v1.${String(i)}`,
          point.x - 20,
          point.y - 42,
          34,
          800,
          TEXT,
          f.sans,
          "right",
        );
      }
    }
    g.restore();
  }
  g.restore();
}

/** Рисует кадр в момент `t` (секунды) на холсте с логическим размером FILM_WIDTH × FILM_HEIGHT. */
export function drawFilm(
  g: CanvasRenderingContext2D,
  time: number,
  fonts: FilmFonts,
) {
  const t = ((time % FILM_DURATION) + FILM_DURATION) % FILM_DURATION;
  g.fillStyle = INK;
  g.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  sceneTask(g, t, fonts);
  sceneAgent(g, t, fonts);
  sceneHarness(g, t, fonts);
  sceneShip(g, t, fonts);
  // Шов цикла: затемнение в начальный кадр, чтобы повтор не прыгал.
  const seam = clamp((t - 15.6) / 0.4);
  if (seam > 0) {
    g.fillStyle = INK;
    g.globalAlpha = seam;
    g.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
    g.globalAlpha = 1;
  }
}

/** Текстовый эквивалент для скринридера: то же, что показывает анимация. */
export const FILM_DESCRIPTION =
  "Анимация курса: задача ставится в подходе AI-first, агент проходит спецификацию, задачи, код и проверку, harness растёт ступенями AGENTS.md, skills, MCP, RAG и evals, агенты закрывают много задач, релизы идут один за другим.";
