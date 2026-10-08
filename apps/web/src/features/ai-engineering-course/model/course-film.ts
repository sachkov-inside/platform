/**
 * Анимация курса AI Engineering как чистая функция времени: `drawFilm(ctx, t)` рисует кадр для
 * любого момента без таймеров и накопленного состояния, поэтому пауза и итоговый кадр — просто
 * разные `t`. Сюжет — навыки AI-инженера одним непрерывным действием в тёмном окне: одни и те же
 * плашки и агент живут весь фильм и пружиной перетекают из роли в роль, а надписи на них
 * сменяются. Окно не двигается, счётчиков и полос прогресса нет.
 */

export const FILM_WIDTH = 960;
export const FILM_HEIGHT = 640;
export const FILM_DURATION = 27.6;
/** Итоговый кадр для reduced motion: первая сцена с выполненной задачей. */
export const FILM_POSTER_TIME = 4.0;

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

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Выход с замедлением, как `--motion-ease-out` страницы. */
const easeOut = (x: number) => 1 - (1 - clamp(x)) ** 3;
/** Появление элемента за `duration` секунд, начиная с `at`. */
const appear = (s: number, at: number, duration = 0.45) =>
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

const LEFT = 56;
const RIGHT = FILM_WIDTH - 56;
const INNER = RIGHT - LEFT;

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

/** Заливка с прозрачностью: токены могут быть в oklch, поэтому альфа задаётся отдельно. */
function fill(g: CanvasRenderingContext2D, color: string, alpha = 1) {
  g.save();
  g.globalAlpha *= alpha;
  g.fillStyle = color;
  g.fill();
  g.restore();
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

/** Круглый значок с галочкой: результат шага готов. */
function done(
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
function rise(g: CanvasRenderingContext2D, p: number, draw: () => void) {
  if (p <= 0) return;
  g.save();
  g.globalAlpha *= p;
  g.translate(0, 14 * (1 - p));
  draw();
  g.restore();
}

/** Курсор нарисован кодом: стрелка с тёмным контуром и кольцо нажатия. */
function cursor(
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

/* ---------- Сквозные элементы ---------- */

/**
 * Геометрия плашки. Одни и те же плашки живут весь фильм и перетекают пружиной из роли в роль:
 * поле ввода становится шкалой контекста, строки шагов — файлами, файлы — инструментами и так
 * далее. `o` — видимость плашки, `paper` и `accent` — сила светлой и акцентной заливки.
 */
interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly r: number;
  readonly o: number;
  readonly paper: number;
  readonly accent: number;
}
const BOX_KEYS = ["x", "y", "w", "h", "r", "o", "paper", "accent"] as const;
const SLOTS = ["T", "S0", "S1", "S2", "S3", "S4", "S5"] as const;
type Slot = (typeof SLOTS)[number];

/** Агент: кольцо с точками, которое переходит из роли в роль вместе с плашками. */
interface Orb {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly o: number;
}
const ORB_KEYS = ["x", "y", "r", "o"] as const;

const box = (
  x: number,
  y: number,
  w: number,
  h: number,
  paper = 0.08,
  o = 1,
  accent = 0,
): Box => ({ x, y, w, h, r: Math.min(18, h / 2), o, paper, accent });
const pill = (
  x: number,
  y: number,
  w: number,
  h: number,
  paper: number,
  accent = 0,
): Box => ({
  ...box(x, y, w, h, paper, 1, accent),
  r: h / 2,
});
const hidden = (from: Box): Box => ({ ...from, o: 0 });

interface Scene {
  readonly start: number;
  readonly end: number;
  readonly title: string;
  readonly boxes: Readonly<Record<Slot, Box>>;
  readonly orb: Orb;
  readonly draw: (scene: Live) => void;
}

/** Текущее состояние кадра: геометрия плашек и агента в момент `t`. */
interface Live {
  readonly g: CanvasRenderingContext2D;
  /** Время внутри сцены. */
  readonly s: number;
  /** Видимость содержимого сцены: появляется после перетекания, гаснет до следующего. */
  readonly a: number;
  readonly f: FilmFonts;
  readonly c: FilmPalette;
  readonly b: Readonly<Record<Slot, Box>>;
  readonly orb: Orb;
}

/* ---------- Содержимое сцен ---------- */

const PROMPT = "Добавь вход через GitHub";
const STEPS = [
  ["План", "spec.md"],
  ["Код", "+124 −8"],
  ["Проверки", "24/24"],
] as const;
function drawDevelop({ g, s, a, f, c, b }: Live) {
  const bar = b.T;
  const mid = bar.y + bar.h / 2;
  const typed = Math.floor(clamp((s - 0.3) / 1.1) * PROMPT.length);
  const shown = PROMPT.slice(0, typed);
  text(g, "›", bar.x + 30, mid, 40, 700, c.accent, f.sans, { alpha: a });
  text(g, shown, bar.x + 64, mid, 34, 600, c.paper, f.sans, { alpha: a });
  const caret = bar.x + 64 + width(g, shown, `600 34px ${f.sans}`) + 5;
  if (typed < PROMPT.length || Math.floor(s * 3) % 2 === 0) {
    g.save();
    g.globalAlpha *= a;
    g.fillStyle = c.accent;
    g.fillRect(caret, mid - 20, 3, 40);
    g.restore();
  }
  // Кнопка отправки: после отправки она и становится агентом следующей сцены.
  const sent = clamp((s - 1.5) / 0.3);
  g.beginPath();
  g.arc(bar.x + bar.w - 42, mid, 26, 0, Math.PI * 2);
  fill(g, sent > 0 ? c.accent : c.paper, a * (sent > 0 ? 1 : 0.12));
  const rows = [b.S0, b.S1, b.S2];
  for (const [i, [label, value]] of STEPS.entries()) {
    const row = rows[i];
    if (!row) continue;
    const at = 1.9 + i * 0.5;
    const p = appear(s, at) * a;
    const y = row.y + row.h / 2;
    rise(g, p, () => {
      done(g, row.x + 20, y, appear(s, at + 0.15, 0.4), c);
      text(g, label, row.x + 60, y, 34, 650, c.paper, f.sans);
      text(g, value, row.x + row.w, y, 30, 600, c.paper, f.mono, {
        align: "right",
        alpha: 0.6,
      });
    });
  }
}

/** Линия от агента к плашке: по ней видно, с чем агент сейчас работает. */
function link(
  g: CanvasRenderingContext2D,
  orb: Orb,
  to: Box,
  alpha: number,
  c: FilmPalette,
) {
  if (alpha <= 0) return;
  const sx = orb.x + orb.r + 6;
  const ex = to.x - 6;
  const ey = to.y + to.h / 2;
  g.save();
  g.strokeStyle = c.paper;
  g.globalAlpha *= alpha * 0.3;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(sx, orb.y);
  g.bezierCurveTo(sx + 70, orb.y, ex - 70, ey, ex, ey);
  g.stroke();
  g.restore();
}

/** Импульс по линии от агента к плашке; `reach` меньше 1 — импульс останавливается на пути. */
function pulse(
  g: CanvasRenderingContext2D,
  orb: Orb,
  to: Box,
  k: number,
  alpha: number,
  c: FilmPalette,
) {
  if (k <= 0 || alpha <= 0) return;
  const sx = orb.x + orb.r + 6;
  const ex = to.x - 6;
  const ey = to.y + to.h / 2;
  const x = lerp(sx, ex, k);
  const y = lerp(orb.y, ey, k * k * (3 - 2 * k));
  g.beginPath();
  g.arc(x, y, 8, 0, Math.PI * 2);
  fill(g, c.accent, alpha);
}

const FILES = [
  ["AGENTS.md", true],
  ["skills/", true],
  ["docs/auth.md", true],
  ["checks/", true],
  ["legacy/", false],
  ["vendor/", false],
] as const;
function drawContext({ g, s, a, f, c, b, orb }: Live) {
  const chips = [b.S0, b.S1, b.S2, b.S3, b.S4, b.S5];
  for (const [i, [name, read]] of FILES.entries()) {
    const chip = chips[i];
    if (!chip) continue;
    const lit = read ? appear(s, 0.8 + i * 0.3, 0.3) : 0;
    link(g, orb, chip, a * lit, c);
    const y = chip.y + chip.h / 2;
    g.beginPath();
    g.arc(chip.x + 26, y, 7, 0, Math.PI * 2);
    fill(g, read ? c.accent : c.paper, a * (read ? lit : 0.2));
    text(g, name, chip.x + 46, y + 1, 28, 600, c.paper, f.mono, {
      alpha: a * (read ? 0.45 + 0.55 * lit : 0.3),
    });
  }
  const meter = b.T;
  const used = appear(s, 2.2, 0.8);
  text(g, "Контекст", meter.x, meter.y - 38, 32, 650, c.paper, f.sans, {
    alpha: a,
  });
  text(
    g,
    `${String(Math.round(18 * used))}k из 200k`,
    meter.x + meter.w,
    meter.y - 38,
    30,
    600,
    c.paper,
    f.mono,
    {
      align: "right",
      alpha: a * 0.7,
    },
  );
  roundRect(
    g,
    meter.x,
    meter.y,
    Math.max(meter.h, meter.w * 0.09 * used),
    meter.h,
    meter.h / 2,
  );
  fill(g, c.accent, a);
  text(g, "агент", orb.x, orb.y + orb.r + 34, 30, 650, c.paper, f.sans, {
    align: "center",
    alpha: a * 0.7,
  });
}

const TOOLS = [
  ["github.list_repos", true],
  ["docs.search", true],
  ["db.delete_project", false],
] as const;
function drawTools({ g, s, a, f, c, b, orb }: Live) {
  const cards = [b.S0, b.S1, b.S2];
  for (const [i, [name, allowed]] of TOOLS.entries()) {
    const card = cards[i];
    if (!card) continue;
    link(g, orb, card, a, c);
    // К разрешённому инструменту импульс доходит, к запрещённому останавливается на полпути.
    const call = 0.8 + i * 0.7;
    const k = clamp((s - call) / 0.5) * (allowed ? 1 : 0.5);
    if (k < (allowed ? 1 : 0.5)) pulse(g, orb, card, k, a, c);
    const y = card.y + card.h / 2;
    text(g, name, card.x + 28, y, 30, 600, c.paper, f.mono, { alpha: a });
    const result = appear(s, call + 0.5, 0.35) * a;
    if (allowed) done(g, card.x + card.w - 40, y, result, c);
    else
      text(g, "нет прав", card.x + card.w - 26, y, 30, 650, c.accent, f.sans, {
        align: "right",
        alpha: result,
      });
  }
  text(g, "агент", orb.x, orb.y + orb.r + 34, 30, 650, c.paper, f.sans, {
    align: "center",
    alpha: a * 0.7,
  });
}

function drawRag({ g, s, a, f, c, b }: Live) {
  const q = b.T;
  text(
    g,
    "Как устроен вход?",
    q.x + q.w / 2,
    q.y + q.h / 2 + 1,
    34,
    650,
    c.paper,
    f.sans,
    {
      align: "center",
      alpha: a,
    },
  );
  const sources = [
    [b.S0, "[1] docs/auth.md"],
    [b.S1, "[2] adr-012.md"],
  ] as const;
  for (const [i, [chip, label]] of sources.entries()) {
    text(
      g,
      label,
      chip.x + 22,
      chip.y + chip.h / 2 + 1,
      28,
      600,
      c.paper,
      f.mono,
      {
        alpha: a * appear(s, 0.6 + i * 0.3),
      },
    );
  }
  const answer = b.S2;
  const lines = [
    ["Вход идёт через GitHub OAuth ", "[1]"],
    ["Сессия живёт 30 дней ", "[2]"],
  ] as const;
  for (const [i, [line, ref]] of lines.entries()) {
    const y = answer.y + 52 + i * 64;
    rise(g, appear(s, 1.5 + i * 0.5) * a, () => {
      text(g, line, answer.x + 28, y, 34, 600, c.paper, f.sans);
      const w = width(g, line, `600 34px ${f.sans}`);
      text(g, ref, answer.x + 28 + w, y, 30, 700, c.accent, f.mono);
    });
  }
}

const CLICK = 2.3;
function drawControl({ g, s, a, f, c, b }: Live) {
  const cmd = b.T;
  const mid = cmd.y + cmd.h / 2;
  text(g, "$", cmd.x + 28, mid, 30, 600, c.paper, f.mono, { alpha: a * 0.5 });
  text(
    g,
    "git push --force origin main",
    cmd.x + 60,
    mid,
    30,
    600,
    c.paper,
    f.mono,
    { alpha: a },
  );
  const warn = b.S0;
  const wy = warn.y + warn.h / 2;
  rise(g, appear(s, 0.5) * a, () => {
    g.beginPath();
    g.arc(warn.x + 12, wy, 10, 0, Math.PI * 2);
    fill(g, c.accent);
    text(
      g,
      "Нужно подтверждение человека",
      warn.x + 40,
      wy + 1,
      34,
      650,
      c.paper,
      f.sans,
    );
  });
  const allow = b.S1;
  const deny = b.S2;
  text(
    g,
    "Разрешить",
    allow.x + allow.w / 2,
    allow.y + allow.h / 2 + 2,
    32,
    650,
    c.paper,
    f.sans,
    {
      align: "center",
      alpha: a,
    },
  );
  text(
    g,
    "Отклонить",
    deny.x + deny.w / 2,
    deny.y + deny.h / 2 + 2,
    32,
    700,
    c.ink,
    f.sans,
    {
      align: "center",
      alpha: a,
    },
  );
  const result = b.S3;
  const ry = result.y + result.h / 2;
  rise(g, appear(s, CLICK + 0.35) * a, () => {
    done(g, result.x + 20, ry, appear(s, CLICK + 0.45, 0.4), c);
    text(
      g,
      "Отклонено, main не тронут",
      result.x + 60,
      ry + 1,
      32,
      650,
      c.paper,
      f.sans,
    );
  });
  // Курсор подходит к «Отклонить» и нажимает.
  const tx = deny.x + deny.w * 0.62;
  const ty = deny.y + deny.h * 0.55;
  const x = track(
    s,
    [
      [0, RIGHT - 40],
      [1.1, tx],
    ],
    120,
    22,
  );
  const y = track(
    s,
    [
      [0, 610],
      [1.1, ty],
    ],
    120,
    22,
  );
  const visible =
    Math.min(appear(s, 0.8, 0.3), 1 - appear(s, CLICK + 0.9, 0.3)) * a;
  const press = s >= CLICK && s < CLICK + 0.45 ? (s - CLICK) / 0.45 : 0;
  cursor(g, x, y, visible, press, c);
}

const SCORES = [
  ["v1", 0.82, false],
  ["v2", 0.91, true],
] as const;
function drawEvals({ g, s, a, f, c, b }: Live) {
  const tag = b.T;
  text(
    g,
    "40 сценариев",
    tag.x + tag.w / 2,
    tag.y + tag.h / 2 + 1,
    28,
    600,
    c.paper,
    f.mono,
    {
      align: "center",
      alpha: a * 0.8,
    },
  );
  const bars = [b.S1, b.S2];
  for (const [i, [name, score, best]] of SCORES.entries()) {
    const bar = bars[i];
    if (!bar) continue;
    const y = bar.y + bar.h / 2;
    const grow = appear(s, 0.5 + i * 0.6, 0.9);
    text(g, name, LEFT, y, 34, 700, c.paper, f.mono, { alpha: a });
    roundRect(
      g,
      bar.x,
      bar.y,
      Math.max(bar.h, bar.w * score * grow),
      bar.h,
      bar.h / 2,
    );
    fill(g, best ? c.accent : c.paper, a * (best ? 1 : 0.35));
    text(
      g,
      `${String(Math.round(score * 100 * grow))}%`,
      RIGHT,
      y,
      32,
      700,
      c.paper,
      f.mono,
      {
        align: "right",
        alpha: a * (best ? 1 : 0.7),
      },
    );
  }
  const result = b.S3;
  const ry = result.y + result.h / 2;
  rise(g, appear(s, 2.3) * a, () => {
    done(g, result.x + 20, ry, appear(s, 2.4, 0.4), c);
    text(
      g,
      "v2 лучше — можно в релиз",
      result.x + 60,
      ry + 1,
      34,
      650,
      c.paper,
      f.sans,
    );
  });
}

/* ---------- Раскладки сцен ---------- */

const TOP = 176;
// Разработка: поле ввода и три строки шагов.
const A_BAR = pill(LEFT, TOP, INNER, 84, 0.08);
const A_ROWS = [0, 1, 2].map((i) =>
  box(LEFT, TOP + 116 + i * 72, INNER, 60, 0),
);
// Контекст: агент слева, файлы двумя колонками справа, внизу шкала контекста.
const CHIP_X = 260;
const CHIP_W = (RIGHT - CHIP_X - 16) / 2;
const B_CHIPS = [0, 1, 2, 3, 4, 5].map((i) =>
  box(
    CHIP_X + (i % 2) * (CHIP_W + 16),
    TOP + Math.floor(i / 2) * 72,
    CHIP_W,
    56,
    0.07,
  ),
);
const B_METER = pill(LEFT, 548, INNER, 16, 0.1);
const ORB_SIDE: Orb = { x: 128, y: 290, r: 52, o: 1 };
// Инструменты: три карточки справа от агента.
const TOOL_X = 330;
const C_TOOLS = [0, 1, 2].map((i) =>
  box(TOOL_X, TOP + i * 120, RIGHT - TOOL_X, 84, 0.08),
);
// RAG и дальше: агент маленький слева вверху, рядом с ним вопрос или команда.
const ORB_TOP: Orb = { x: 96, y: TOP + 38, r: 30, o: 1 };
const D_QUESTION = pill(RIGHT - 380, TOP, 380, 76, 0, 1);
const D_SOURCES = [
  box(LEFT, TOP + 110, 330, 60, 0.12),
  box(LEFT + 346, TOP + 110, 300, 60, 0.12),
];
const D_ANSWER = box(LEFT, TOP + 196, INNER, 170, 0.06);
const E_COMMAND = box(150, TOP, RIGHT - 150, 76, 0.08);
const E_WARN = box(LEFT, TOP + 104, INNER, 60, 0);
const E_ALLOW = box(LEFT, TOP + 196, 260, 76, 0.1);
const E_DENY = box(LEFT + 280, TOP + 196, 260, 76, 1);
const E_RESULT = box(LEFT, TOP + 306, INNER, 60, 0);
const F_TAG = pill(RIGHT - 250, TOP + 10, 250, 56, 0.08);
const F_BARS = [
  box(150, TOP + 120, RIGHT - 120 - 150, 32, 0.08),
  box(150, TOP + 200, RIGHT - 120 - 150, 32, 0.08),
].map((bar) => ({ ...bar, r: 16 }));
const F_RESULT = box(LEFT, TOP + 290, INNER, 60, 0);

const at = (list: readonly Box[], i: number) => list[i] ?? A_BAR;

const SCENES: readonly Scene[] = [
  {
    start: 0,
    end: 4.6,
    title: "Разработка с агентом",
    boxes: {
      T: A_BAR,
      S0: at(A_ROWS, 0),
      S1: at(A_ROWS, 1),
      S2: at(A_ROWS, 2),
      S3: hidden(at(A_ROWS, 2)),
      S4: hidden(at(A_ROWS, 2)),
      S5: hidden(at(A_ROWS, 2)),
    },
    // Агент спрятан в кнопке отправки и выходит из неё в следующей сцене.
    orb: { x: LEFT + INNER - 42, y: TOP + 42, r: 26, o: 0 },
    draw: drawDevelop,
  },
  {
    start: 4.6,
    end: 9.2,
    title: "Harness и контекст",
    boxes: {
      T: B_METER,
      S0: at(B_CHIPS, 0),
      S1: at(B_CHIPS, 1),
      S2: at(B_CHIPS, 2),
      S3: at(B_CHIPS, 3),
      S4: at(B_CHIPS, 4),
      S5: at(B_CHIPS, 5),
    },
    orb: ORB_SIDE,
    draw: drawContext,
  },
  {
    start: 9.2,
    end: 13.8,
    title: "MCP и инструменты",
    boxes: {
      T: hidden(B_METER),
      S0: at(C_TOOLS, 0),
      S1: at(C_TOOLS, 1),
      S2: at(C_TOOLS, 2),
      S3: hidden(at(C_TOOLS, 2)),
      S4: hidden(at(C_TOOLS, 2)),
      S5: hidden(at(C_TOOLS, 2)),
    },
    orb: { ...ORB_SIDE, y: TOP + 162 },
    draw: drawTools,
  },
  {
    start: 13.8,
    end: 18.4,
    title: "RAG по документам",
    boxes: {
      T: D_QUESTION,
      S0: at(D_SOURCES, 0),
      S1: at(D_SOURCES, 1),
      S2: D_ANSWER,
      S3: hidden(D_ANSWER),
      S4: hidden(D_ANSWER),
      S5: hidden(D_ANSWER),
    },
    orb: ORB_TOP,
    draw: drawRag,
  },
  {
    start: 18.4,
    end: 23.0,
    title: "Контроль агентов",
    boxes: {
      T: E_COMMAND,
      S0: E_WARN,
      S1: E_ALLOW,
      S2: E_DENY,
      S3: E_RESULT,
      S4: hidden(E_RESULT),
      S5: hidden(E_RESULT),
    },
    orb: ORB_TOP,
    draw: drawControl,
  },
  {
    start: 23.0,
    end: FILM_DURATION,
    title: "Evals перед релизом",
    boxes: {
      T: F_TAG,
      S0: hidden(E_WARN),
      S1: at(F_BARS, 0),
      S2: at(F_BARS, 1),
      S3: F_RESULT,
      S4: hidden(F_RESULT),
      S5: hidden(F_RESULT),
    },
    orb: ORB_TOP,
    draw: drawEvals,
  },
];

/** Перед концом цикла всё перетекает обратно в раскладку первой сцены: стык цикла не виден. */
const LOOP_BACK = FILM_DURATION - 0.9;

function liveBox(t: number, slot: Slot): Box {
  const first = SCENES[0]?.boxes[slot] ?? A_BAR;
  const keysOf = (key: (typeof BOX_KEYS)[number]) => [
    ...SCENES.map((scene) => [scene.start, scene.boxes[slot][key]] as const),
    [LOOP_BACK, first[key]] as const,
  ];
  const value = (key: (typeof BOX_KEYS)[number]) =>
    track(t, keysOf(key), 150, 24);
  return {
    x: value("x"),
    y: value("y"),
    w: value("w"),
    h: value("h"),
    r: value("r"),
    o: clamp(value("o")),
    paper: clamp(value("paper")),
    accent: clamp(value("accent")),
  };
}

function liveOrb(t: number): Orb {
  const first = SCENES[0]?.orb ?? ORB_SIDE;
  const value = (key: (typeof ORB_KEYS)[number]) =>
    track(
      t,
      [
        ...SCENES.map((scene) => [scene.start, scene.orb[key]] as const),
        [LOOP_BACK, first[key]] as const,
      ],
      150,
      24,
    );
  return {
    x: value("x"),
    y: value("y"),
    r: Math.max(0, value("r")),
    o: clamp(value("o")),
  };
}

function drawBox(g: CanvasRenderingContext2D, b: Box, c: FilmPalette) {
  if (b.o <= 0 || b.w <= 0 || b.h <= 0) return;
  roundRect(g, b.x, b.y, b.w, b.h, Math.min(b.r, b.h / 2));
  if (b.paper > 0) fill(g, c.paper, b.o * b.paper);
  if (b.accent > 0) {
    roundRect(g, b.x, b.y, b.w, b.h, Math.min(b.r, b.h / 2));
    fill(g, c.accent, b.o * b.accent);
  }
}

function drawOrb(g: CanvasRenderingContext2D, orb: Orb, c: FilmPalette) {
  if (orb.o <= 0 || orb.r <= 0) return;
  g.save();
  g.globalAlpha *= orb.o;
  g.strokeStyle = c.accent;
  g.lineWidth = Math.max(3, orb.r / 10);
  g.beginPath();
  g.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2);
  g.stroke();
  const dot = Math.max(3, orb.r / 10);
  for (const dx of [-1, 0, 1]) {
    g.beginPath();
    g.arc(orb.x + dx * orb.r * 0.32, orb.y, dot, 0, Math.PI * 2);
    fill(g, c.paper);
  }
  g.restore();
}

/** Содержимое сцены появляется, когда плашки почти встали, и гаснет перед следующим перетеканием. */
function contentAlpha(t: number, scene: Scene) {
  const end = scene.end >= FILM_DURATION ? LOOP_BACK : scene.end;
  return Math.min(
    appear(t, scene.start + 0.3, 0.35),
    1 - appear(t, end - 0.4, 0.3),
  );
}

export function drawFilm(
  g: CanvasRenderingContext2D,
  time: number,
  fonts: FilmFonts,
  palette: FilmPalette = DEFAULT_PALETTE,
) {
  const t = ((time % FILM_DURATION) + FILM_DURATION) % FILM_DURATION;
  const c = palette;
  g.fillStyle = c.ink;
  g.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  const b: Record<Slot, Box> = {
    T: liveBox(t, "T"),
    S0: liveBox(t, "S0"),
    S1: liveBox(t, "S1"),
    S2: liveBox(t, "S2"),
    S3: liveBox(t, "S3"),
    S4: liveBox(t, "S4"),
    S5: liveBox(t, "S5"),
  };
  const orb = liveOrb(t);
  for (const slot of SLOTS) drawBox(g, b[slot], c);
  drawOrb(g, orb, c);
  for (const scene of SCENES) {
    const a = contentAlpha(t, scene);
    if (a <= 0 || t < scene.start) continue;
    // Название навыка меняется вместе с содержимым: старое гаснет, новое проявляется.
    text(g, scene.title, LEFT, 96, 46, 750, c.paper, fonts.sans, { alpha: a });
    scene.draw({ g, s: t - scene.start, a, f: fonts, c, b, orb });
  }
}

/** Текстовый эквивалент для скринридера: то же, что показывает анимация. */
export const FILM_DESCRIPTION =
  "Анимация курса: навыки AI-инженера одним непрерывным действием. Разработка с агентом: задача «Добавь вход через GitHub», готовы план, код и проверки. Harness и контекст: агент читает только нужные файлы, контекст занят на 18 тысяч токенов из 200. MCP и инструменты: агент вызывает разрешённые инструменты, к удалению проекта прав нет. RAG: ответ на вопрос о входе со ссылками на документы. Контроль агентов: человек отклоняет опасную команду. Evals: новая версия агента набирает 91 % против 82 % и идёт в релиз.";
