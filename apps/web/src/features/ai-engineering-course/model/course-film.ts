/**
 * Анимация курса AI Engineering как чистая функция времени: `drawFilm(ctx, t)` рисует кадр для
 * любого момента без таймеров и накопленного состояния, поэтому пауза и итоговый кадр — просто
 * разные `t`. Одна тёмная форма перетекает из состояния в состояние и не обрывается; курсор ведёт
 * каждую смену. Бриф и покадровый план — docs/evidence/issue-808/animation/README.md.
 */

export const FILM_WIDTH = 960;
export const FILM_HEIGHT = 640;
export const FILM_DURATION = 20;
/** Итоговый кадр для reduced motion: harness собран целиком. */
export const FILM_POSTER_TIME = 13.8;

const CANVAS = "#f3f1ed";
const INK = "#202124";
const INK_HIGH = "#2f3035";
const INK_LINE = "rgba(243, 241, 237, 0.16)";
const TEXT = "#f3f1ed";
const MUTED = "rgba(243, 241, 237, 0.6)";
const INK_MUTED = "rgba(32, 33, 36, 0.55)";
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

/* ---------- Состояния одной формы ---------- */

type StateId =
  | "pill"
  | "prompt"
  | "think"
  | "plan"
  | "diff"
  | "checks"
  | "harness"
  | "agents"
  | "releases"
  | "toast";

interface State {
  readonly id: StateId;
  readonly at: number;
  readonly w: number;
  readonly h: number;
  readonly r: number;
}

/** Покадровый план: каждое состояние держится около двух секунд, форма перетекает между ними. */
const STATES: readonly State[] = [
  { id: "pill", at: 0, w: 430, h: 100, r: 50 },
  { id: "prompt", at: 1.5, w: 780, h: 112, r: 56 },
  { id: "think", at: 4.1, w: 120, h: 120, r: 60 },
  { id: "plan", at: 5.4, w: 560, h: 400, r: 34 },
  { id: "diff", at: 7.7, w: 640, h: 360, r: 30 },
  { id: "checks", at: 9.6, w: 660, h: 220, r: 40 },
  { id: "harness", at: 11.6, w: 540, h: 460, r: 34 },
  { id: "agents", at: 14.0, w: 720, h: 330, r: 34 },
  { id: "releases", at: 16.0, w: 600, h: 390, r: 34 },
  { id: "toast", at: 18.0, w: 620, h: 104, r: 52 },
  { id: "pill", at: 19.3, w: 430, h: 100, r: 50 },
];

const CX = FILM_WIDTH / 2;
const CY = FILM_HEIGHT / 2;

function shape(t: number) {
  const key = (pick: (state: State) => number) =>
    STATES.map((state) => [state.at, pick(state)] as const);
  return {
    w: track(
      t,
      key((s) => s.w),
      230,
      26,
    ),
    h: track(
      t,
      key((s) => s.h),
      230,
      28,
    ),
    r: track(
      t,
      key((s) => s.r),
      230,
      28,
    ),
  };
}

/** Содержимое входит после начала перетекания и уходит до следующего. */
function contentAlpha(t: number, index: number) {
  const state = STATES[index];
  if (!state) return 0;
  const next = STATES[index + 1]?.at ?? FILM_DURATION;
  return Math.min(
    clamp((t - state.at - 0.14) / 0.16),
    clamp((next - 0.08 - t) / 0.12),
  );
}

/* ---------- Рисование ---------- */

function roundRect(
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

function text(
  g: CanvasRenderingContext2D,
  value: string,
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
  g.fillText(value, x, y);
}

function width(g: CanvasRenderingContext2D, value: string, font: string) {
  g.font = font;
  return g.measureText(value).width;
}

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

/** Курсор нарисован кодом: стрелка с тёмным контуром и кольцо нажатия. */
function cursor(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  alpha: number,
  press: number,
) {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  if (press > 0 && press < 1) {
    g.strokeStyle = ACCENT_BRIGHT;
    g.lineWidth = 3;
    g.globalAlpha = alpha * (1 - press);
    g.beginPath();
    g.arc(x, y, 8 + press * 30, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = alpha;
  }
  const s = 1 - 0.12 * Math.sin(Math.PI * clamp(press));
  g.translate(x, y);
  g.scale(s * 1.35, s * 1.35);
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
  g.strokeStyle = INK;
  g.lineWidth = 1.6;
  g.lineJoin = "round";
  g.stroke();
  g.restore();
}

/* ---------- Содержимое состояний ---------- */

function drawPill(g: CanvasRenderingContext2D, t: number, f: FilmFonts) {
  const pulse = 1 + 0.18 * Math.sin(t * 5);
  g.fillStyle = ACCENT_BRIGHT;
  g.beginPath();
  g.arc(-150, 0, 11 * pulse, 0, Math.PI * 2);
  g.fill();
  text(g, "AI Engineering", -120, 2, 40, 800, TEXT, f.sans);
}

const PROMPT = "Добавь вход через GitHub";
function drawPrompt(
  g: CanvasRenderingContext2D,
  t: number,
  f: FilmFonts,
  local: number,
) {
  const typed = Math.floor(clamp((local - 0.35) / 1.3) * PROMPT.length);
  const shown = PROMPT.slice(0, typed);
  text(g, "›", -350, 2, 44, 700, ACCENT_BRIGHT, f.sans);
  text(g, shown, -312, 2, 36, 600, TEXT, f.sans);
  const caret = -312 + width(g, shown, `600 36px ${f.sans}`) + 6;
  if (typed < PROMPT.length || Math.floor(t * 3) % 2 === 0) {
    g.fillStyle = ACCENT_BRIGHT;
    g.fillRect(caret, -20, 3, 42);
  }
  // Кнопка отправки нажимается курсором и на миг вдавливается.
  const press = clamp((local - 2.25) / 0.3);
  const s = 1 - 0.12 * Math.sin(Math.PI * press);
  g.save();
  g.translate(330, 0);
  g.scale(s, s);
  g.fillStyle = typed >= PROMPT.length ? ACCENT : INK_HIGH;
  g.beginPath();
  g.arc(0, 0, 36, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = TEXT;
  g.lineWidth = 4;
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(0, 14);
  g.lineTo(0, -14);
  g.moveTo(-11, -3);
  g.lineTo(0, -14);
  g.lineTo(11, -3);
  g.stroke();
  g.restore();
}

function drawThink(g: CanvasRenderingContext2D, t: number) {
  g.strokeStyle = ACCENT_BRIGHT;
  g.lineWidth = 7;
  g.lineCap = "round";
  const spin = t * 5;
  g.beginPath();
  g.arc(0, 0, 30, spin, spin + Math.PI * 1.3);
  g.stroke();
}

const PLAN = ["Спецификация", "Задачи", "Код", "Тесты"] as const;
function drawPlan(
  g: CanvasRenderingContext2D,
  f: FilmFonts,
  local: number,
  w: number,
  h: number,
) {
  const left = -w / 2 + 44;
  text(g, "План", left, -h / 2 + 60, 36, 800, TEXT, f.sans);
  text(
    g,
    "агент",
    w / 2 - 44,
    -h / 2 + 60,
    28,
    700,
    ACCENT_BRIGHT,
    f.sans,
    "right",
  );
  for (const [i, step] of PLAN.entries()) {
    const y = -h / 2 + 138 + i * 66;
    const on = clamp((local - 0.5 - i * 0.38) / 0.28);
    g.fillStyle = INK_LINE;
    g.fillRect(left, y + 30, w - 88, 1.5);
    // Кружок шага заполняется, когда шаг сделан.
    g.strokeStyle = on > 0 ? ACCENT_BRIGHT : MUTED;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(left + 16, y, 16, 0, Math.PI * 2);
    g.stroke();
    if (on > 0) {
      g.save();
      g.globalAlpha *= on;
      g.fillStyle = ACCENT;
      g.beginPath();
      g.arc(left + 16, y, 16, 0, Math.PI * 2);
      g.fill();
      g.restore();
      check(g, left + 16, y, 16, on, TEXT);
    }
    text(g, step, left + 52, y + 1, 32, 700, on > 0.5 ? TEXT : MUTED, f.sans);
  }
}

const DIFF = [
  ["+", "auth/github.ts", 0.9],
  ["+", "auth/session.ts", 0.7],
  ["~", "routes/login.tsx", 0.5],
  ["+", "tests/login.test.ts", 0.8],
] as const;
function drawDiff(
  g: CanvasRenderingContext2D,
  f: FilmFonts,
  local: number,
  w: number,
  h: number,
) {
  const left = -w / 2 + 44;
  text(g, "Изменения", left, -h / 2 + 58, 34, 800, TEXT, f.sans);
  for (const [i, [mark, file, size]] of DIFF.entries()) {
    const p = spring(local - 0.35 - i * 0.22, 240, 22);
    if (p <= 0) continue;
    const y = -h / 2 + 128 + i * 52;
    g.save();
    g.globalAlpha *= clamp(p * 1.4);
    g.translate(24 * (1 - p), 0);
    text(
      g,
      mark,
      left,
      y,
      32,
      800,
      mark === "+" ? ACCENT_BRIGHT : MUTED,
      f.mono,
    );
    text(g, file, left + 40, y, 30, 600, TEXT, f.mono);
    g.fillStyle = mark === "+" ? ACCENT : INK_HIGH;
    g.fillRect(w / 2 - 44 - 120 * size * p, y - 6, 120 * size * p, 12);
    g.restore();
  }
  const pr = spring(local - 1.35, 240, 18);
  if (pr > 0) {
    g.save();
    g.translate(w / 2 - 44 - 120, h / 2 - 50);
    g.scale(0.7 + 0.3 * pr, 0.7 + 0.3 * pr);
    g.globalAlpha *= clamp(pr * 1.5);
    roundRect(g, -120, -26, 240, 52, 26);
    g.fillStyle = ACCENT;
    g.fill();
    text(g, "PR #42 открыт", 0, 1, 28, 700, TEXT, f.sans, "center");
    g.restore();
  }
}

function drawChecks(
  g: CanvasRenderingContext2D,
  f: FilmFonts,
  local: number,
  w: number,
) {
  const left = -w / 2 + 44;
  const p = clamp((local - 0.3) / 1.1);
  const passed = Math.round(24 * p);
  text(g, "Проверки", left, -58, 32, 800, TEXT, f.sans);
  text(
    g,
    `${String(passed)}/24`,
    w / 2 - 44,
    -58,
    32,
    800,
    p >= 1 ? ACCENT_BRIGHT : MUTED,
    f.sans,
    "right",
  );
  roundRect(g, left, -12, w - 88, 16, 8);
  g.fillStyle = INK_HIGH;
  g.fill();
  roundRect(g, left, -12, (w - 88) * p, 16, 8);
  g.fillStyle = ACCENT_BRIGHT;
  g.fill();
  // Переключатель merge включается курсором, когда проверки прошли.
  const on = spring(local - 1.55, 260, 22);
  const tx = w / 2 - 44 - 92;
  roundRect(g, tx, 30, 92, 50, 25);
  g.fillStyle = on > 0.5 ? ACCENT : INK_HIGH;
  g.fill();
  g.fillStyle = TEXT;
  g.beginPath();
  g.arc(tx + 25 + 42 * on, 55, 19, 0, Math.PI * 2);
  g.fill();
  text(
    g,
    "merge",
    tx - 18,
    56,
    28,
    700,
    on > 0.5 ? TEXT : MUTED,
    f.sans,
    "right",
  );
}

const LAYERS = ["AGENTS.md", "skills", "MCP", "RAG", "evals"] as const;
function drawHarness(
  g: CanvasRenderingContext2D,
  f: FilmFonts,
  local: number,
  w: number,
  h: number,
) {
  const left = -w / 2 + 40;
  text(g, "harness проекта", left, -h / 2 + 54, 30, 700, MUTED, f.sans);
  const version = Math.min(
    LAYERS.length,
    Math.floor(clamp((local - 0.3) / 1.9) * LAYERS.length + 1),
  );
  text(
    g,
    `v${String(version)}`,
    w / 2 - 40,
    -h / 2 + 54,
    30,
    800,
    ACCENT_BRIGHT,
    f.sans,
    "right",
  );
  // Слои встают снизу вверх внутри формы: система собирается из частей.
  for (const [i, name] of LAYERS.entries()) {
    const p = spring(local - 0.3 - i * 0.42, 230, 19);
    if (p <= 0) continue;
    const y = h / 2 - 50 - i * 68;
    g.save();
    g.globalAlpha *= clamp(p * 1.6);
    g.translate(0, -60 * (1 - p));
    roundRect(g, left, y - 28, w - 80, 56, 14);
    g.fillStyle = i === LAYERS.length - 1 ? ACCENT : INK_HIGH;
    g.fill();
    text(g, name, left + 22, y + 1, 30, 700, TEXT, f.mono);
    g.restore();
  }
}

const AGENTS = [
  ["Роли и доступ", 1.3],
  ["MCP-сервер", 1.7],
  ["Поиск по докам", 1.1],
] as const;
function drawAgents(
  g: CanvasRenderingContext2D,
  t: number,
  f: FilmFonts,
  local: number,
  w: number,
  h: number,
) {
  const left = -w / 2 + 44;
  text(
    g,
    "3 агента работают параллельно",
    left,
    -h / 2 + 54,
    30,
    700,
    MUTED,
    f.sans,
  );
  for (const [i, [task, speed]] of AGENTS.entries()) {
    const y = -h / 2 + 128 + i * 70;
    const p = clamp(((local - 0.35) * speed) / 1.5);
    g.fillStyle = ACCENT_BRIGHT;
    g.beginPath();
    g.arc(
      left + 12,
      y,
      10 + (p < 1 ? Math.sin(t * 8 + i) * 2 : 0),
      0,
      Math.PI * 2,
    );
    g.fill();
    text(g, task, left + 40, y - 14, 30, 700, TEXT, f.sans);
    roundRect(g, left + 40, y + 12, w - 190, 10, 5);
    g.fillStyle = INK_HIGH;
    g.fill();
    roundRect(g, left + 40, y + 12, (w - 190) * p, 10, 5);
    g.fillStyle = p >= 1 ? ACCENT : ACCENT_BRIGHT;
    g.fill();
    if (p >= 1) {
      check(
        g,
        w / 2 - 70,
        y,
        26,
        clamp((local - 0.35 - 1.5 / speed) / 0.25),
        ACCENT_BRIGHT,
      );
    }
  }
}

const RELEASE_RISE = [0, 22, 14, 52, 46, 88, 104, 150] as const;
function drawReleases(
  g: CanvasRenderingContext2D,
  f: FilmFonts,
  local: number,
  w: number,
  h: number,
) {
  const left = -w / 2 + 44;
  const p = clamp((local - 0.3) / 1.4);
  const count = Math.round(2 + 12 * p);
  text(g, String(count), left, -h / 2 + 78, 76, 800, TEXT, f.sans);
  const numberW = width(g, String(count), `800 76px ${f.sans}`);
  text(g, "релизов", left + numberW + 16, -h / 2 + 90, 30, 700, MUTED, f.sans);
  const points = RELEASE_RISE.map((rise, i) => ({
    x: left + (i * (w - 88)) / (RELEASE_RISE.length - 1),
    y: h / 2 - 60 - rise,
  }));
  g.strokeStyle = INK_LINE;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(left, h / 2 - 40);
  g.lineTo(w / 2 - 44, h / 2 - 40);
  g.stroke();
  g.strokeStyle = ACCENT_BRIGHT;
  g.lineWidth = 5;
  g.lineCap = "round";
  g.lineJoin = "round";
  const reach = p * (points.length - 1);
  let tip = points[0];
  g.beginPath();
  for (const [i, point] of points.entries()) {
    const prev = points[i - 1];
    if (!prev) {
      g.moveTo(point.x, point.y);
      continue;
    }
    const k = clamp(reach - (i - 1));
    if (k <= 0) break;
    tip = { x: lerp(prev.x, point.x, k), y: lerp(prev.y, point.y, k) };
    g.lineTo(tip.x, tip.y);
  }
  g.stroke();
  if (p > 0 && tip) {
    g.fillStyle = ACCENT_BRIGHT;
    g.beginPath();
    g.arc(tip.x, tip.y, 10, 0, Math.PI * 2);
    g.fill();
  }
}

function drawToast(g: CanvasRenderingContext2D, f: FilmFonts, local: number) {
  g.fillStyle = ACCENT;
  g.beginPath();
  g.arc(-250, 0, 26, 0, Math.PI * 2);
  g.fill();
  check(g, -250, 0, 24, clamp((local - 0.35) / 0.3), TEXT);
  text(g, "Релиз v1.4 выпущен", -206, 2, 36, 800, TEXT, f.sans);
}

/* ---------- Курсор по сцене ---------- */

/** Точки курсора в координатах сцены: он подходит к элементу и нажимает. */
const CURSOR: readonly (readonly [number, number, number])[] = [
  [0, 760, 560],
  [0.9, 600, 350],
  [3.4, 830, 330],
  [4.4, 760, 520],
  [10.6, 640, 390],
  [11.1, 690, 378],
  [12.0, 820, 560],
  [19.0, 760, 560],
];
const CLICKS = [1.2, 3.75, 11.15] as const;
function drawCursor(g: CanvasRenderingContext2D, t: number) {
  const x = track(
    t,
    CURSOR.map(([at, px]) => [at, px] as const),
    120,
    22,
  );
  const y = track(
    t,
    CURSOR.map(([at, , py]) => [at, py] as const),
    120,
    22,
  );
  const visible =
    Math.min(clamp((t - 0.5) / 0.3), clamp((4.4 - t) / 0.3)) +
    Math.min(clamp((t - 10.3) / 0.3), clamp((11.5 - t) / 0.25));
  let press = 0;
  for (const at of CLICKS)
    if (t >= at && t < at + 0.45) press = (t - at) / 0.45;
  cursor(g, x, y, clamp(visible), press);
}

/* ---------- Кадр ---------- */

export function drawFilm(
  g: CanvasRenderingContext2D,
  time: number,
  fonts: FilmFonts,
) {
  const t = ((time % FILM_DURATION) + FILM_DURATION) % FILM_DURATION;
  g.fillStyle = CANVAS;
  g.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);

  const { w, h, r } = shape(t);
  g.save();
  g.translate(CX, CY);
  g.shadowColor = "rgba(32, 33, 36, 0.22)";
  g.shadowBlur = 40;
  g.shadowOffsetY = 18;
  roundRect(g, -w / 2, -h / 2, w, h, r);
  g.fillStyle = INK;
  g.fill();
  g.shadowColor = "transparent";
  roundRect(g, -w / 2, -h / 2, w, h, r);
  g.clip();

  for (const [index, state] of STATES.entries()) {
    const alpha = contentAlpha(t, index);
    if (alpha <= 0) continue;
    const local = t - state.at;
    g.save();
    g.globalAlpha = alpha;
    switch (state.id) {
      case "pill":
        drawPill(g, t, fonts);
        break;
      case "prompt":
        drawPrompt(g, t, fonts, local);
        break;
      case "think":
        drawThink(g, t);
        break;
      case "plan":
        drawPlan(g, fonts, local, w, h);
        break;
      case "diff":
        drawDiff(g, fonts, local, w, h);
        break;
      case "checks":
        drawChecks(g, fonts, local, w);
        break;
      case "harness":
        drawHarness(g, fonts, local, w, h);
        break;
      case "agents":
        drawAgents(g, t, fonts, local, w, h);
        break;
      case "releases":
        drawReleases(g, fonts, local, w, h);
        break;
      case "toast":
        drawToast(g, fonts, local);
        break;
    }
    g.restore();
  }
  g.restore();

  // Подпись под кружком «думает» стоит вне формы, на светлом фоне.
  const thinkIndex = STATES.findIndex((s) => s.id === "think");
  const thinking = contentAlpha(t, thinkIndex);
  if (thinking > 0) {
    g.save();
    g.globalAlpha = thinking;
    text(
      g,
      "агент изучает проект",
      CX,
      CY + 110,
      30,
      700,
      INK_MUTED,
      fonts.sans,
      "center",
    );
    g.restore();
  }
  drawCursor(g, t);
}

/** Текстовый эквивалент для скринридера: то же, что показывает анимация. */
export const FILM_DESCRIPTION =
  "Анимация курса: разработчик ставит агенту задачу в подходе AI-first, агент составляет план, вносит изменения и открывает pull request, проверки проходят, harness проекта растёт слоями AGENTS.md, skills, MCP, RAG и evals, несколько агентов работают параллельно, растёт число релизов.";
