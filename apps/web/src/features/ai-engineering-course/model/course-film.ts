/**
 * Анимация курса AI Engineering как чистая функция времени: `drawFilm(ctx, t)` рисует кадр для
 * любого момента без таймеров и накопленного состояния, поэтому пауза и итоговый кадр — просто
 * разные `t`. Сюжет — навыки AI-инженера: шесть сцен в одном тёмном окне. Вверху полоса прогресса,
 * номер и название навыка; сцена показывает навык в действии и держит результат, чтобы его успели
 * прочитать. Окно не двигается: меняется только содержимое, коротким появлением и уходом.
 */

export const FILM_WIDTH = 960;
export const FILM_HEIGHT = 640;
/** Длительность одной сцены. */
const SCENE = 4.6;
export const FILM_DURATION = SCENE * 6;
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

interface Frame {
  readonly g: CanvasRenderingContext2D;
  /** Время внутри сцены. */
  readonly s: number;
  readonly f: FilmFonts;
  readonly c: FilmPalette;
}

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

/** Светлая плашка на тёмном окне: поле ввода, файл, инструмент. */
function tile(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  c: FilmPalette,
  alpha = 0.08,
) {
  roundRect(g, x, y, w, h, Math.min(18, h / 2));
  fill(g, c.paper, alpha);
}

/* ---------- Сцены ---------- */

const PROMPT = "Добавь вход через GitHub";
const STEPS = [
  ["План", "spec.md"],
  ["Код", "+124 −8"],
  ["Проверки", "24/24"],
] as const;
/** Разработка с агентом: задача уходит агенту, план, код и проверки готовы. */
function sceneDevelop({ g, s, f, c }: Frame) {
  rise(g, appear(s, 0), () => {
    tile(g, LEFT, 216, INNER, 84, c);
    const typed = Math.floor(clamp((s - 0.3) / 1.1) * PROMPT.length);
    const shown = PROMPT.slice(0, typed);
    text(g, "›", LEFT + 30, 260, 40, 700, c.accent, f.sans);
    text(g, shown, LEFT + 64, 260, 34, 600, c.paper, f.sans);
    const caret = LEFT + 64 + width(g, shown, `600 34px ${f.sans}`) + 5;
    if (typed < PROMPT.length || Math.floor(s * 3) % 2 === 0) {
      g.fillStyle = c.accent;
      g.fillRect(caret, 240, 3, 40);
    }
    const sent = clamp((s - 1.5) / 0.3);
    g.beginPath();
    g.arc(RIGHT - 42, 258, 26, 0, Math.PI * 2);
    fill(g, sent > 0 ? c.accent : c.paper, sent > 0 ? 1 : 0.12);
  });
  for (const [i, [label, value]] of STEPS.entries()) {
    const at = 1.9 + i * 0.5;
    const y = 360 + i * 76;
    rise(g, appear(s, at), () => {
      done(g, LEFT + 20, y, appear(s, at + 0.15, 0.4), c);
      text(g, label, LEFT + 60, y, 34, 650, c.paper, f.sans);
      text(g, value, RIGHT, y, 30, 600, c.paper, f.mono, {
        align: "right",
        alpha: 0.6,
      });
    });
  }
}

const FILES = [
  ["AGENTS.md", true],
  ["skills/", true],
  ["docs/auth.md", true],
  ["checks/", true],
  ["legacy/", false],
  ["vendor/", false],
] as const;
/** Harness и контекст: агент читает только нужное, контекст почти пуст. */
function sceneContext({ g, s, f, c }: Frame) {
  const columnW = (INNER - 24) / 2;
  for (const [i, [name, read]] of FILES.entries()) {
    const x = LEFT + (i % 2) * (columnW + 24);
    const y = 216 + Math.floor(i / 2) * 76;
    const lit = read ? appear(s, 0.7 + i * 0.3, 0.3) : 0;
    rise(g, appear(s, i * 0.06), () => {
      tile(g, x, y, columnW, 60, c, 0.06 + 0.08 * lit);
      g.beginPath();
      g.arc(x + 28, y + 30, 7, 0, Math.PI * 2);
      fill(g, read ? c.accent : c.paper, read ? lit : 0.2);
      text(g, name, x + 50, y + 31, 30, 600, c.paper, f.mono, {
        alpha: read ? 0.45 + 0.55 * lit : 0.32,
      });
    });
  }
  const meter = appear(s, 1.9, 0.8);
  rise(g, appear(s, 1.6), () => {
    text(g, "Контекст", LEFT, 476, 32, 650, c.paper, f.sans);
    const used = Math.round(18 * meter);
    text(g, `${String(used)}k из 200k`, RIGHT, 476, 30, 600, c.paper, f.mono, {
      align: "right",
      alpha: 0.7,
    });
    roundRect(g, LEFT, 516, INNER, 16, 8);
    fill(g, c.paper, 0.1);
    roundRect(g, LEFT, 516, Math.max(16, INNER * 0.09 * meter), 16, 8);
    fill(g, c.accent);
  });
}

const TOOLS = [
  ["github.list_repos", true],
  ["docs.search", true],
  ["db.delete_project", false],
] as const;
/** MCP и инструменты: агент вызывает разрешённые инструменты, к опасному прав нет. */
function sceneTools({ g, s, f, c }: Frame) {
  const agentX = LEFT + 70;
  const agentY = 390;
  rise(g, appear(s, 0), () => {
    g.save();
    g.strokeStyle = c.accent;
    g.lineWidth = 5;
    g.beginPath();
    g.arc(agentX, agentY, 54, 0, Math.PI * 2);
    g.stroke();
    g.restore();
    for (const dx of [-16, 0, 16]) {
      g.beginPath();
      g.arc(agentX + dx, agentY, 5, 0, Math.PI * 2);
      fill(g, c.paper);
    }
    text(g, "агент", agentX, agentY + 86, 30, 650, c.paper, f.sans, {
      align: "center",
      alpha: 0.7,
    });
  });
  const cardX = 330;
  for (const [i, [name, allowed]] of TOOLS.entries()) {
    const y = 250 + i * 140;
    const at = 0.4 + i * 0.15;
    const call = 1.0 + i * 0.7;
    rise(g, appear(s, at), () => {
      const startX = agentX + 60;
      g.save();
      g.strokeStyle = c.paper;
      g.globalAlpha *= 0.25;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(startX, agentY);
      g.bezierCurveTo(startX + 80, agentY, cardX - 80, y, cardX - 6, y);
      g.stroke();
      g.restore();
      // Импульс вызова: к разрешённому инструменту доходит, к запрещённому останавливается на полпути.
      const reach = allowed ? 1 : 0.5;
      const k = clamp((s - call) / 0.5) * reach;
      if (s >= call && k < reach) {
        const px = lerp(startX, cardX - 6, k);
        const py = lerp(agentY, y, k * k * (3 - 2 * k));
        g.beginPath();
        g.arc(px, py, 8, 0, Math.PI * 2);
        fill(g, c.accent);
      }
      tile(g, cardX, y - 44, RIGHT - cardX, 88, c);
      text(g, name, cardX + 28, y, 30, 600, c.paper, f.mono);
      const result = appear(s, call + 0.5, 0.35);
      if (allowed) {
        done(g, RIGHT - 40, y, result, c);
      } else if (result > 0) {
        text(g, "нет прав", RIGHT - 26, y, 30, 650, c.accent, f.sans, {
          align: "right",
          alpha: result,
        });
      }
    });
  }
}

/** RAG: вопрос, найденные источники и ответ со ссылками на них. */
function sceneRag({ g, s, f, c }: Frame) {
  rise(g, appear(s, 0), () => {
    const question = "Как устроен вход?";
    const w = width(g, question, `650 34px ${f.sans}`) + 64;
    roundRect(g, RIGHT - w, 216, w, 76, 38);
    fill(g, c.accent);
    text(g, question, RIGHT - 32, 255, 34, 650, c.paper, f.sans, {
      align: "right",
    });
  });
  const sources = ["[1] docs/auth.md", "[2] adr-012.md"] as const;
  let x = LEFT;
  for (const [i, source] of sources.entries()) {
    const w = width(g, source, `600 28px ${f.mono}`) + 44;
    const sx = x;
    rise(g, appear(s, 0.8 + i * 0.3), () => {
      tile(g, sx, 330, w, 60, c, 0.12);
      text(g, source, sx + 22, 361, 28, 600, c.paper, f.mono);
    });
    x += w + 16;
  }
  const lines = [
    ["Вход идёт через GitHub OAuth ", "[1]"],
    ["Сессия живёт 30 дней ", "[2]"],
  ] as const;
  for (const [i, [line, ref]] of lines.entries()) {
    const y = 448 + i * 64;
    rise(g, appear(s, 1.7 + i * 0.5), () => {
      text(g, line, LEFT, y, 34, 600, c.paper, f.sans);
      const w = width(g, line, `600 34px ${f.sans}`);
      text(g, ref, LEFT + w, y, 30, 700, c.accent, f.mono);
    });
  }
}

const ALLOW = { x: LEFT, y: 420, w: 260, h: 76 };
const DENY = { x: LEFT + 280, y: 420, w: 260, h: 76 };
const CLICK = 2.3;
/** Контроль агентов: опасное действие ждёт человека, человек его отклоняет. */
function sceneControl({ g, s, f, c }: Frame) {
  rise(g, appear(s, 0), () => {
    tile(g, LEFT, 216, INNER, 84, c);
    text(g, "$", LEFT + 28, 259, 30, 600, c.paper, f.mono, { alpha: 0.5 });
    text(
      g,
      "git push --force origin main",
      LEFT + 60,
      259,
      30,
      600,
      c.paper,
      f.mono,
    );
  });
  rise(g, appear(s, 0.6), () => {
    g.beginPath();
    g.arc(LEFT + 12, 354, 10, 0, Math.PI * 2);
    fill(g, c.accent);
    text(
      g,
      "Нужно подтверждение человека",
      LEFT + 40,
      355,
      34,
      650,
      c.paper,
      f.sans,
    );
  });
  const pressed = clamp((s - CLICK) / 0.3);
  rise(g, appear(s, 1.0), () => {
    roundRect(g, ALLOW.x, ALLOW.y, ALLOW.w, ALLOW.h, 18);
    fill(g, c.paper, 0.1);
    text(
      g,
      "Разрешить",
      ALLOW.x + ALLOW.w / 2,
      ALLOW.y + 39,
      32,
      650,
      c.paper,
      f.sans,
      {
        align: "center",
      },
    );
    const scale = 1 - 0.05 * Math.sin(Math.PI * pressed);
    g.save();
    g.translate(DENY.x + DENY.w / 2, DENY.y + DENY.h / 2);
    g.scale(scale, scale);
    roundRect(g, -DENY.w / 2, -DENY.h / 2, DENY.w, DENY.h, 18);
    fill(g, c.paper);
    text(g, "Отклонить", 0, 2, 32, 700, c.ink, f.sans, { align: "center" });
    g.restore();
  });
  rise(g, appear(s, CLICK + 0.35), () => {
    done(g, LEFT + 20, 556, appear(s, CLICK + 0.45, 0.4), c);
    text(
      g,
      "Отклонено, main не тронут",
      LEFT + 60,
      557,
      32,
      650,
      c.paper,
      f.sans,
    );
  });
  // Курсор подходит к «Отклонить» и нажимает.
  const tx = DENY.x + DENY.w * 0.62;
  const ty = DENY.y + DENY.h * 0.55;
  const x = track(
    s,
    [
      [0, RIGHT - 40],
      [1.2, tx],
    ],
    120,
    22,
  );
  const y = track(
    s,
    [
      [0, 600],
      [1.2, ty],
    ],
    120,
    22,
  );
  const visible = Math.min(
    appear(s, 0.9, 0.3),
    1 - appear(s, CLICK + 0.9, 0.3),
  );
  const press = s >= CLICK && s < CLICK + 0.45 ? (s - CLICK) / 0.45 : 0;
  cursor(g, x, y, visible, press, c);
}

/** Evals: новая версия агента проходит набор сценариев лучше старой. */
function sceneEvals({ g, s, f, c }: Frame) {
  rise(g, appear(s, 0), () => {
    text(g, "40 сценариев", RIGHT, 236, 30, 600, c.paper, f.mono, {
      align: "right",
      alpha: 0.6,
    });
  });
  const rows = [
    ["v1", 0.82, false],
    ["v2", 0.91, true],
  ] as const;
  const barX = LEFT + 90;
  const barW = RIGHT - 120 - barX;
  for (const [i, [name, score, best]] of rows.entries()) {
    const y = 316 + i * 96;
    const grow = appear(s, 0.5 + i * 0.6, 0.9);
    rise(g, appear(s, 0.2 + i * 0.15), () => {
      text(g, name, LEFT, y, 34, 700, c.paper, f.mono);
      roundRect(g, barX, y - 16, barW, 32, 16);
      fill(g, c.paper, 0.08);
      roundRect(g, barX, y - 16, Math.max(32, barW * score * grow), 32, 16);
      fill(g, best ? c.accent : c.paper, best ? 1 : 0.35);
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
          alpha: best ? 1 : 0.7,
        },
      );
    });
  }
  rise(g, appear(s, 2.3), () => {
    done(g, LEFT + 20, 540, appear(s, 2.4, 0.4), c);
    text(
      g,
      "v2 лучше — можно в релиз",
      LEFT + 60,
      541,
      34,
      650,
      c.paper,
      f.sans,
    );
  });
}

const SCENES: readonly (readonly [
  title: string,
  draw: (frame: Frame) => void,
])[] = [
  ["Разработка с агентом", sceneDevelop],
  ["Harness и контекст", sceneContext],
  ["MCP и инструменты", sceneTools],
  ["RAG по документам", sceneRag],
  ["Контроль агентов", sceneControl],
  ["Evals перед релизом", sceneEvals],
];

/* ---------- Кадр ---------- */

/** Полоса прогресса: пройденные навыки светлые, текущий заполняется акцентом. */
function drawProgress(
  g: CanvasRenderingContext2D,
  index: number,
  s: number,
  c: FilmPalette,
) {
  const gap = 10;
  const w = (INNER - gap * (SCENES.length - 1)) / SCENES.length;
  for (let i = 0; i < SCENES.length; i++) {
    const x = LEFT + i * (w + gap);
    roundRect(g, x, 44, w, 6, 3);
    fill(g, c.paper, i < index ? 0.75 : 0.16);
    if (i === index) {
      roundRect(g, x, 44, Math.max(6, w * clamp(s / SCENE)), 6, 3);
      fill(g, c.accent);
    }
  }
}

export function drawFilm(
  g: CanvasRenderingContext2D,
  time: number,
  fonts: FilmFonts,
  palette: FilmPalette = DEFAULT_PALETTE,
) {
  const t = ((time % FILM_DURATION) + FILM_DURATION) % FILM_DURATION;
  const index = Math.min(SCENES.length - 1, Math.floor(t / SCENE));
  const s = t - index * SCENE;
  const c = palette;
  g.fillStyle = c.ink;
  g.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  drawProgress(g, index, s, c);
  const scene = SCENES[index];
  if (!scene) return;
  const [title, draw] = scene;
  // Сцена входит и уходит коротким сдвигом и прозрачностью, окно остаётся на месте.
  const enter = appear(s, 0, 0.4);
  const exit = easeOut((s - (SCENE - 0.35)) / 0.35);
  g.save();
  g.globalAlpha = enter * (1 - exit);
  g.translate(0, -10 * exit);
  text(g, `0${String(index + 1)}`, LEFT, 104, 28, 700, c.accent, fonts.mono);
  text(g, title, LEFT, 152, 46, 750, c.paper, fonts.sans);
  draw({ g, s, f: fonts, c });
  g.restore();
}

/** Текстовый эквивалент для скринридера: то же, что показывает анимация. */
export const FILM_DESCRIPTION =
  "Анимация курса: шесть навыков AI-инженера. Разработка с агентом: задача «Добавь вход через GitHub», готовы план, код и проверки. Harness и контекст: агент читает только нужные файлы, контекст занят на 18 тысяч токенов из 200. MCP и инструменты: агент вызывает разрешённые инструменты, к удалению проекта прав нет. RAG: ответ на вопрос о входе со ссылками на документы. Контроль агентов: человек отклоняет опасную команду. Evals: новая версия агента набирает 91 % против 82 % и идёт в релиз.";
