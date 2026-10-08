/**
 * Анимация курса AI Engineering как чистая функция времени: `drawFilm(ctx, t)` рисует кадр для
 * любого момента без таймеров и накопленного состояния, поэтому пауза и итоговый кадр — просто
 * разные `t`. Сюжет — навыки AI-инженера одним непрерывным действием в тёмном окне: одни и те же
 * плашки и агент живут весь фильм и пружиной перетекают из роли в роль, а надписи на них
 * сменяются. Окно не двигается, подписей, счётчиков и полос прогресса нет. Приёмы — по
 * разбору «How to build motion design studio» (@0xMovez, 27.09.2026): одна форма без разрезов,
 * смена содержимого через короткое размытие, событие каждые полсекунды, курсор ведёт смену.
 */

import { type AgentId } from "./agent-logos";
import {
  appear,
  clamp,
  cursor,
  DEFAULT_PALETTE,
  done,
  easeOut,
  fill,
  FILM_HEIGHT,
  FILM_WIDTH,
  INNER,
  LEFT,
  lerp,
  logo,
  RIGHT,
  rise,
  roundRect,
  spring,
  text,
  track,
  width,
  type FilmFonts,
  type FilmPalette,
} from "./film-kit";

export {
  DEFAULT_PALETTE,
  FILM_HEIGHT,
  FILM_WIDTH,
  spring,
  track,
  type FilmFonts,
  type FilmPalette,
} from "./film-kit";

export const FILM_DURATION = 18;
/** Итоговый кадр для reduced motion: первая сцена с выполненной задачей. */
export const FILM_POSTER_TIME = 2.6;

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
const SLOTS = ["T", "S0", "S1", "S2", "S3", "S4", "S5"] as const;
type Slot = (typeof SLOTS)[number];
type Boxes = Readonly<Record<Slot, Box>>;

/** Агент: кольцо со звездой. Один агент делится на троих, когда работа идёт параллельно. */
interface Orb {
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly o: number;
}
type Orbs = readonly [Orb, Orb, Orb];

const box = (
  x: number,
  y: number,
  w: number,
  h: number,
  paper = 0.08,
  accent = 0,
): Box => ({ x, y, w, h, r: Math.min(18, h / 2), o: 1, paper, accent });
const pill = (
  x: number,
  y: number,
  w: number,
  h: number,
  paper: number,
  accent = 0,
): Box => ({
  ...box(x, y, w, h, paper, accent),
  r: h / 2,
});
const hidden = (from: Box): Box => ({ ...from, o: 0 });
const hiddenOrb = (from: Orb): Orb => ({ ...from, o: 0 });

interface Scene {
  readonly start: number;
  readonly end: number;
  readonly boxes: Boxes;
  readonly orbs: Orbs;
  /** Какой агент в каждом кольце: Claude, Codex и DeepSeek чередуются от сцены к сцене. */
  readonly agents: readonly [AgentId, AgentId, AgentId];
  readonly draw: (scene: Live) => void;
}

/** Текущее состояние кадра: геометрия плашек и агентов в момент `t`. */
interface Live {
  readonly g: CanvasRenderingContext2D;
  /** Время внутри сцены. */
  readonly s: number;
  /** Видимость содержимого: появляется после начала перетекания, гаснет до следующего. */
  readonly a: number;
  readonly f: FilmFonts;
  readonly c: FilmPalette;
  readonly b: Boxes;
  readonly orbs: Orbs;
}

/* ---------- Содержимое сцен ---------- */

const PROMPT = "Добавь вход через GitHub";
const SEND = 1.15;
const STEPS = [
  ["План", "spec.md"],
  ["Код", "+124 −8"],
  ["Проверки", "24/24"],
] as const;
function drawDevelop({ g, s, a, f, c, b }: Live) {
  const bar = b.T;
  const mid = bar.y + bar.h / 2;
  const typed = Math.floor(clamp((s - 0.15) / 0.8) * PROMPT.length);
  const shown = PROMPT.slice(0, typed);
  logo(g, "claude", bar.x + 40, mid, 36, a);
  text(g, shown, bar.x + 76, mid, 34, 600, c.paper, f.sans, { alpha: a });
  const caret = bar.x + 76 + width(g, shown, `600 34px ${f.sans}`) + 5;
  if (s < SEND && (typed < PROMPT.length || Math.floor(s * 4) % 2 === 0)) {
    g.save();
    g.globalAlpha *= a;
    g.fillStyle = c.accent;
    g.fillRect(caret, mid - 20, 3, 40);
    g.restore();
  }
  // Кнопка отправки: по клику она и становится агентом следующей сцены.
  const sent = s >= SEND;
  const press = clamp((s - SEND) / 0.25);
  g.beginPath();
  g.arc(
    bar.x + bar.w - 42,
    mid,
    26 * (1 - 0.12 * Math.sin(Math.PI * press)),
    0,
    Math.PI * 2,
  );
  fill(g, sent ? c.accent : c.paper, a * (sent ? 1 : 0.14));
  const rows = [b.S0, b.S1, b.S2];
  for (const [i, [label, value]] of STEPS.entries()) {
    const row = rows[i];
    if (!row) continue;
    const at = SEND + 0.2 + i * 0.3;
    const y = row.y + row.h / 2;
    rise(g, appear(s, at, 0.3) * a, () => {
      done(g, row.x + 20, y, appear(s, at + 0.1, 0.3), c);
      text(g, label, row.x + 60, y, 34, 650, c.paper, f.sans);
      text(g, value, row.x + row.w, y, 30, 600, c.paper, f.mono, {
        align: "right",
        alpha: 0.6,
      });
    });
  }
}

const FILES = [
  ["AGENTS.md", 4, true],
  ["skills/", 6, true],
  ["docs/auth.md", 8, true],
  ["legacy/", 0, false],
] as const;
/**
 * Контекст: нужные файлы копиями перелетают в окно контекста агента и встают в нём строками,
 * счётчик токенов растёт. Ненужный файл зачёркивается и остаётся снаружи.
 */
function drawContext({ g, s, a, f, c, b }: Live) {
  const chips = [b.S0, b.S1, b.S2, b.S3];
  const box = b.T;
  text(g, "Контекст", box.x + 24, box.y + 36, 30, 650, c.paper, f.sans, {
    alpha: a,
  });
  let tokens = 0;
  let slot = 0;
  for (const [i, [name, size, read]] of FILES.entries()) {
    const chip = chips[i];
    if (!chip) continue;
    const y = chip.y + chip.h / 2;
    const at = 0.35 + i * 0.4;
    const fly = read ? spring(s - at, 260, 26) : 0;
    const landed = read ? appear(s, at + 0.25, 0.2) : 0;
    // Сам файл остаётся в проекте: после копирования он отмечен точкой.
    g.beginPath();
    g.arc(chip.x + 26, y, 7, 0, Math.PI * 2);
    fill(
      g,
      read ? c.accent : c.paper,
      a * (read ? 0.35 + 0.65 * landed : 0.25),
    );
    text(g, name, chip.x + 48, y + 1, 30, 600, c.paper, f.mono, {
      alpha: a * (read ? 1 : 0.4),
    });
    if (!read) {
      const cross = appear(s, 1.75, 0.3);
      if (cross > 0) {
        g.save();
        g.globalAlpha *= a * 0.6;
        g.strokeStyle = c.paper;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(chip.x + 44, y);
        g.lineTo(
          chip.x + 44 + (width(g, name, `600 30px ${f.mono}`) + 8) * cross,
          y,
        );
        g.stroke();
        g.restore();
      }
      continue;
    }
    // Копия файла летит в окно контекста и встаёт строкой.
    const tx = box.x + 20;
    const ty = box.y + 76 + slot * 66;
    const tw = box.w - 40;
    const x = lerp(chip.x, tx, fly);
    const top = lerp(chip.y, ty, fly);
    const w = lerp(chip.w, tw, fly);
    const h = lerp(chip.h, 50, fly);
    if (s >= at) {
      g.save();
      g.globalAlpha *= a * clamp((s - at) / 0.1);
      roundRect(g, x, top, w, h, 14);
      fill(g, c.paper, 0.1 + 0.06 * (1 - landed));
      text(g, name, x + 20, top + h / 2 + 1, 28, 600, c.paper, f.mono);
      text(
        g,
        `${String(size)}k`,
        x + w - 18,
        top + h / 2 + 1,
        26,
        600,
        c.accent,
        f.mono,
        {
          align: "right",
          alpha: landed,
        },
      );
      g.restore();
    }
    tokens += size * landed;
    slot += 1;
  }
  text(
    g,
    `${String(Math.round(tokens))}k / 200k`,
    box.x + box.w - 24,
    box.y + box.h - 30,
    28,
    600,
    c.paper,
    f.mono,
    {
      align: "right",
      alpha: a * 0.7,
    },
  );
}

const CALLS = [
  ["github.list_repos()", "12 репозиториев", true],
  ['docs.search("вход")', "3 документа", true],
  ['db.delete_project("core")', "нет прав", false],
] as const;
/**
 * Инструменты: журнал вызовов сверху вниз. Вызов появляется, под ним раскрывается ответ;
 * запрещённый вызов вздрагивает и получает отказ.
 */
function drawTools({ g, s, a, f, c, b }: Live) {
  const cards = [b.S0, b.S1, b.S2];
  for (const [i, [call, result, allowed]] of CALLS.entries()) {
    const card = cards[i];
    if (!card) continue;
    const at = 0.25 + i * 0.6;
    const answered = appear(s, at + 0.35, 0.25);
    const shake = allowed
      ? 0
      : Math.sin((s - at - 0.35) * 40) *
        7 *
        Math.max(0, 1 - (s - at - 0.35) / 0.4) *
        (s > at + 0.35 ? 1 : 0);
    rise(g, appear(s, at, 0.25) * a, () => {
      g.save();
      g.translate(shake, 0);
      text(g, "→", card.x + 26, card.y + 34, 30, 700, c.accent, f.mono);
      text(g, call, card.x + 62, card.y + 35, 30, 600, c.paper, f.mono);
      if (answered > 0) {
        const ry = card.y + card.h - 32;
        if (allowed) done(g, card.x + 74, ry, answered, c);
        else {
          g.beginPath();
          g.arc(card.x + 74, ry, 20 * answered, 0, Math.PI * 2);
          fill(g, c.accent, answered);
        }
        text(
          g,
          result,
          card.x + 108,
          ry + 1,
          30,
          650,
          allowed ? c.paper : c.accent,
          f.sans,
          {
            alpha: answered,
          },
        );
      }
      g.restore();
    });
  }
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
        alpha: a * appear(s, 0.3 + i * 0.2, 0.25),
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
    rise(g, appear(s, 0.8 + i * 0.35, 0.3) * a, () => {
      text(g, line, answer.x + 28, y, 34, 600, c.paper, f.sans);
      const w = width(g, line, `600 34px ${f.sans}`);
      text(g, ref, answer.x + 28 + w, y, 30, 700, c.accent, f.mono);
    });
  }
}

/** Три агента работают параллельно: у каждого своя задача, прогресс и итог. */
const LANES = [
  ["Пишет код", "auth/github.ts", 0.25, 1.5],
  ["Пишет тесты", "", 0.35, 1.7],
  ["Делает ревью", "PR #42", 0.9, 1.0],
] as const;
function drawParallel({ g, s, a, f, c, b, orbs }: Live) {
  const lanes = [b.S0, b.S1, b.S2];
  for (const [i, [role, task, start, length]] of LANES.entries()) {
    const lane = lanes[i];
    const orb = orbs[i];
    if (!lane || !orb) continue;
    const p = easeOut((s - start) / length);
    const y = lane.y + lane.h / 2 - 6;
    text(g, role, lane.x + 28, y, 32, 650, c.paper, f.sans, { alpha: a });
    const right = lane.x + lane.w - 28;
    const finished = appear(s, start + length, 0.25);
    const status = i === 1 ? `${String(Math.round(24 * p))}/24` : task;
    text(g, status, right - 46 * finished, y, 28, 600, c.paper, f.mono, {
      align: "right",
      alpha: a * 0.65,
    });
    done(g, right - 14, y, finished * a, c);
    // Полоса прогресса по низу плашки: у каждого агента свой темп.
    const track = lane.w - 56;
    roundRect(g, lane.x + 28, lane.y + lane.h - 18, track, 6, 3);
    fill(g, c.paper, a * 0.1);
    roundRect(
      g,
      lane.x + 28,
      lane.y + lane.h - 18,
      Math.max(6, track * p),
      6,
      3,
    );
    fill(g, c.accent, a);
    // Агент «работает»: кольцо вращается, пока задача не готова.
    if (p > 0 && finished < 1) {
      g.save();
      g.globalAlpha *= a * (1 - finished);
      g.strokeStyle = c.paper;
      g.lineWidth = 3;
      g.beginPath();
      const spin = s * 6 + i;
      g.arc(orb.x, orb.y, orb.r + 8, spin, spin + Math.PI * 0.6);
      g.stroke();
      g.restore();
    }
  }
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
    const grow = appear(s, 0.3 + i * 0.4, 0.7);
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
  rise(g, appear(s, 1.5, 0.3) * a, () => {
    done(g, result.x + 20, ry, appear(s, 1.6, 0.3), c);
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

const TOP = 92;
// Разработка: поле ввода и три строки шагов.
const A_BAR = pill(LEFT, TOP + 40, INNER, 88, 0.08);
const A_ROWS = [0, 1, 2].map((i) =>
  box(LEFT, TOP + 170 + i * 80, INNER, 64, 0),
);
const A_ORB: Orb = { x: LEFT + INNER - 42, y: TOP + 84, r: 26, o: 0 };
// Контекст: файлы проекта колонкой слева, справа окно контекста, агент на его углу.
const FILE_W = 330;
const B_FILES = [0, 1, 2, 3].map((i) =>
  box(LEFT, TOP + 50 + i * 100, FILE_W, 80, 0.07),
);
const B_CONTEXT = box(
  LEFT + FILE_W + 60,
  TOP + 50,
  INNER - FILE_W - 60,
  380,
  0.05,
);
const ORB_CONTEXT: Orb = { x: RIGHT - 4, y: TOP + 50, r: 34, o: 1 };
// Инструменты: журнал вызовов, агент слева вверху.
const ORB_LOG: Orb = { x: LEFT + 34, y: TOP + 80, r: 34, o: 1 };
const C_CALLS = [0, 1, 2].map((i) =>
  box(LEFT + 96, TOP + 40 + i * 128, INNER - 96, 112, 0.08),
);
// RAG и оценка: агент маленький слева вверху.
const ORB_TOP: Orb = { x: 96, y: TOP + 78, r: 32, o: 1 };
const D_QUESTION = pill(RIGHT - 380, TOP + 40, 380, 76, 0, 1);
const D_SOURCES = [
  box(LEFT, TOP + 150, 330, 60, 0.12),
  box(LEFT + 346, TOP + 150, 300, 60, 0.12),
];
const D_ANSWER = box(LEFT, TOP + 236, INNER, 170, 0.06);
// Параллельная работа: три агента, у каждого своя плашка-задача.
const LANE_X = 200;
const E_LANES = [0, 1, 2].map((i) =>
  box(LANE_X, TOP + 30 + i * 140, RIGHT - LANE_X, 112, 0.08),
);
const E_ORBS: Orbs = [
  { x: 112, y: TOP + 86, r: 38, o: 1 },
  { x: 112, y: TOP + 226, r: 38, o: 1 },
  { x: 112, y: TOP + 366, r: 38, o: 1 },
];
const F_TAG = pill(RIGHT - 250, TOP + 50, 250, 56, 0.08);
const F_BARS = [
  { ...box(150, TOP + 170, RIGHT - 120 - 150, 32, 0.08), r: 16 },
  { ...box(150, TOP + 250, RIGHT - 120 - 150, 32, 0.08), r: 16 },
];
const F_RESULT = box(LEFT, TOP + 340, INNER, 64, 0);

const at = (list: readonly Box[], i: number) => list[i] ?? A_BAR;
const solo = (orb: Orb): Orbs => [orb, hiddenOrb(orb), hiddenOrb(orb)];

/** Сцена длится три секунды: каждые полсекунды на экране что-то происходит. */
const SCENES: readonly Scene[] = [
  {
    start: 0,
    end: 3,
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
    orbs: solo(A_ORB),
    agents: ["claude", "claude", "claude"],
    draw: drawDevelop,
  },
  {
    start: 3,
    end: 6,
    boxes: {
      T: B_CONTEXT,
      S0: at(B_FILES, 0),
      S1: at(B_FILES, 1),
      S2: at(B_FILES, 2),
      S3: at(B_FILES, 3),
      S4: hidden(at(B_FILES, 3)),
      S5: hidden(at(B_FILES, 3)),
    },
    orbs: solo(ORB_CONTEXT),
    agents: ["claude", "claude", "claude"],
    draw: drawContext,
  },
  {
    start: 6,
    end: 9,
    boxes: {
      T: hidden(B_CONTEXT),
      S0: at(C_CALLS, 0),
      S1: at(C_CALLS, 1),
      S2: at(C_CALLS, 2),
      S3: hidden(at(C_CALLS, 2)),
      S4: hidden(at(C_CALLS, 2)),
      S5: hidden(at(C_CALLS, 2)),
    },
    orbs: solo(ORB_LOG),
    agents: ["codex", "codex", "codex"],
    draw: drawTools,
  },
  {
    start: 9,
    end: 12,
    boxes: {
      T: D_QUESTION,
      S0: at(D_SOURCES, 0),
      S1: at(D_SOURCES, 1),
      S2: D_ANSWER,
      S3: hidden(D_ANSWER),
      S4: hidden(D_ANSWER),
      S5: hidden(D_ANSWER),
    },
    orbs: solo(ORB_TOP),
    agents: ["deepseek", "deepseek", "deepseek"],
    draw: drawRag,
  },
  {
    start: 12,
    end: 15,
    boxes: {
      T: hidden(D_QUESTION),
      S0: at(E_LANES, 0),
      S1: at(E_LANES, 1),
      S2: at(E_LANES, 2),
      S3: hidden(at(E_LANES, 2)),
      S4: hidden(at(E_LANES, 2)),
      S5: hidden(at(E_LANES, 2)),
    },
    orbs: E_ORBS,
    agents: ["claude", "codex", "deepseek"],
    draw: drawParallel,
  },
  {
    start: 15,
    end: 18,
    boxes: {
      T: F_TAG,
      S0: hidden(at(E_LANES, 0)),
      S1: at(F_BARS, 0),
      S2: at(F_BARS, 1),
      S3: F_RESULT,
      S4: hidden(F_RESULT),
      S5: hidden(F_RESULT),
    },
    orbs: solo(ORB_TOP),
    agents: ["codex", "codex", "codex"],
    draw: drawEvals,
  },
];

/** Перед концом цикла всё перетекает обратно в раскладку первой сцены: стык цикла не виден. */
const LOOP_BACK = FILM_DURATION - 0.6;
/** Пружина перетекания: быстрая, с едва заметным перелётом. */
const MORPH_K = 240;
const MORPH_D = 27;

function keyed(t: number, values: readonly number[], first: number) {
  return track(
    t,
    [
      ...SCENES.map((scene, i) => [scene.start, values[i] ?? first] as const),
      [LOOP_BACK, first] as const,
    ],
    MORPH_K,
    MORPH_D,
  );
}

function liveBox(t: number, slot: Slot): Box {
  const states = SCENES.map((scene) => scene.boxes[slot]);
  const first = states[0] ?? A_BAR;
  const value = (key: keyof Box) =>
    keyed(
      t,
      states.map((state) => state[key]),
      first[key],
    );
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

function liveOrb(t: number, index: 0 | 1 | 2): Orb {
  const states = SCENES.map((scene) => scene.orbs[index]);
  const first = states[0] ?? A_ORB;
  const value = (key: keyof Orb) =>
    keyed(
      t,
      states.map((state) => state[key]),
      first[key],
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
  const r = Math.min(b.r, b.h / 2);
  if (b.paper > 0) {
    roundRect(g, b.x, b.y, b.w, b.h, r);
    fill(g, c.paper, b.o * b.paper);
  }
  if (b.accent > 0) {
    roundRect(g, b.x, b.y, b.w, b.h, r);
    fill(g, c.accent, b.o * b.accent);
  }
}

/** Какой агент в кольце сейчас: при смене сцены логотип перетекает вместе с кольцом. */
function agentAt(t: number, index: 0 | 1 | 2) {
  let current = SCENES[0];
  let previous = SCENES[SCENES.length - 1];
  for (const [i, scene] of SCENES.entries())
    if (t >= scene.start) {
      current = scene;
      previous = SCENES[i - 1] ?? SCENES[SCENES.length - 1];
    }
  const now = current?.agents[index] ?? "claude";
  const before = previous?.agents[index] ?? now;
  return { now, before, mix: appear(t, current?.start ?? 0, 0.3) };
}

/** Агент — светлый кружок с логотипом, как значок приложения. */
function drawOrb(
  g: CanvasRenderingContext2D,
  orb: Orb,
  c: FilmPalette,
  agent: { now: AgentId; before: AgentId; mix: number },
) {
  if (orb.o <= 0 || orb.r <= 0) return;
  g.save();
  g.globalAlpha *= orb.o;
  g.beginPath();
  g.arc(orb.x, orb.y, orb.r, 0, Math.PI * 2);
  fill(g, c.paper);
  const size = orb.r * 1.1;
  if (agent.now === agent.before) logo(g, agent.now, orb.x, orb.y, size, 1);
  else {
    logo(
      g,
      agent.before,
      orb.x,
      orb.y,
      size * (1 - 0.3 * agent.mix),
      1 - agent.mix,
    );
    logo(g, agent.now, orb.x, orb.y, size * (0.7 + 0.3 * agent.mix), agent.mix);
  }
  g.restore();
}

/** Содержимое входит, когда перетекание уже началось, и уходит до следующего. */
function contentAlpha(t: number, scene: Scene) {
  const end = scene.end >= FILM_DURATION ? LOOP_BACK : scene.end;
  return Math.min(
    appear(t, scene.start + 0.12, 0.2),
    1 - appear(t, end - 0.22, 0.16),
  );
}

/** Курсор живёт весь фильм и нажимает кнопку отправки; на стыке цикла он вне кадра. */
const CURSOR: readonly (readonly [number, number, number])[] = [
  [0, 990, 560],
  [0.55, LEFT + INNER - 34, TOP + 96],
  [1.9, 990, 560],
];
function drawCursor(g: CanvasRenderingContext2D, t: number, c: FilmPalette) {
  const x = track(
    t,
    CURSOR.map(([at, px]) => [at, px] as const),
    200,
    26,
  );
  const y = track(
    t,
    CURSOR.map(([at, , py]) => [at, py] as const),
    200,
    26,
  );
  const press = t >= SEND && t < SEND + 0.35 ? (t - SEND) / 0.35 : 0;
  cursor(
    g,
    x,
    y,
    Math.min(appear(t, 0.2, 0.2), 1 - appear(t, 2.0, 0.2)),
    press,
    c,
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
  const b: Boxes = {
    T: liveBox(t, "T"),
    S0: liveBox(t, "S0"),
    S1: liveBox(t, "S1"),
    S2: liveBox(t, "S2"),
    S3: liveBox(t, "S3"),
    S4: liveBox(t, "S4"),
    S5: liveBox(t, "S5"),
  };
  const orbs: Orbs = [liveOrb(t, 0), liveOrb(t, 1), liveOrb(t, 2)];
  for (const slot of SLOTS) drawBox(g, b[slot], c);
  for (const [i, orb] of orbs.entries())
    drawOrb(g, orb, c, agentAt(t, i === 0 ? 0 : i === 1 ? 1 : 2));
  for (const scene of SCENES) {
    const a = contentAlpha(t, scene);
    if (a <= 0 || t < scene.start) continue;
    // Смена содержимого идёт через короткое размытие, а не простым проявлением.
    g.save();
    g.filter = a < 1 ? `blur(${String(Math.round((1 - a) * 8))}px)` : "none";
    scene.draw({ g, s: t - scene.start, a, f: fonts, c, b, orbs });
    g.restore();
  }
  drawCursor(g, t, c);
}

/** Текстовый эквивалент для скринридера: то же, что показывает анимация. */
export const FILM_DESCRIPTION =
  "Анимация курса: навыки AI-инженера одним непрерывным движением. Агент получает задачу «Добавь вход через GitHub» и готовит план, код и проверки. Читает только нужные файлы проекта, контекст занят на 18 тысяч токенов из 200. Через MCP вызывает разрешённые инструменты, к удалению проекта прав нет. Отвечает на вопрос о входе со ссылками на документы. Три агента параллельно пишут код, тесты и делают ревью. Evals показывают, что новая версия агента лучше старой: 91 % против 82 %, её можно выпускать.";
