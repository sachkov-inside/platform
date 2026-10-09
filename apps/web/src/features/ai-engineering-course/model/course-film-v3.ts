/**
 * Третья версия анимации курса: сюжет первой версии (навыки AI-инженера), но переходы и законы
 * движения — по словарю движка Pronin из проекта vertical-content. Код Pronin не переносится:
 * это собственная реализация описанных там приёмов.
 *
 * Переходы между сценами разные:
 * - aperture-cut: камера влетает в кнопку отправки, следующая сцена уже видна внутри неё;
 * - motion-cut: сцена дрейфует и уходит с разгоном, новая приходит в том же направлении по
 *   out-expo с длинным хвостом; без размытия движения (выбор владельца 08.10.2026);
 * - world-pan: камера едет вниз по общему миру с лёгким отъездом.
 * Элементы появляются законами arrive, pop, rise, cascade, бросок по дуге, press; кадр «живой» —
 * сцена слегка парит; всё встаёт за 0,3 с до склейки, и кадр склейки никогда не пустой.
 */

import { type AgentId } from "./agent-logos";
import {
  clamp,
  DEFAULT_PALETTE,
  done,
  fill,
  FILM_HEIGHT,
  FILM_WIDTH,
  INNER,
  LEFT,
  lerp,
  logo,
  RIGHT,
  roundRect,
  text,
  width,
  cursor,
  type FilmFonts,
  type FilmPalette,
} from "./film-kit";

export const FILM_V3_DURATION = 19;
/** Итоговый кадр для reduced motion: задача отправлена, план, код и проверки готовы. */
export const FILM_V3_POSTER_TIME = 2.9;

const W = FILM_WIDTH;
const H = FILM_HEIGHT;
const CX = W / 2;
const CY = H / 2;
const TOP = 92;

/* ---------- Законы движения ---------- */

/** Выход по экспоненте: быстрый старт и длинное замедление. */
const outExpo = (p: number) => (p >= 1 ? 1 : 1 - 2 ** (-10 * clamp(p)));
/** «Покоящаяся» экспонента: скорость на конце ровно ноль. */
const restExpo = (p: number) => (1 - 2 ** (-10 * clamp(p))) / (1 - 2 ** -10);
/** Разгон к склейке. */
const accel = (u: number) => clamp(u) ** 2.6;
const smootherstep = (x: number) => {
  const k = clamp(x);
  return k * k * k * (k * (k * 6 - 15) + 10);
};
/** easeOutBack: прибытие с перелётом; сила 1,7 — для мелких объектов, 0,9 — для крупных. */
const back = (p: number, strength: number) => {
  const k = clamp(p) - 1;
  return 1 + (strength + 1) * k * k * k + strength * k * k;
};
/** arrive: 0 → 1 за 0,62 с с перелётом. */
const arrive = (s: number, at: number, strength = 0.9, duration = 0.62) =>
  s <= at ? 0 : back((s - at) / duration, strength);
/** pop: масштаб от нуля с перелётом. */
const pop = (s: number, at: number, strength = 1.7, duration = 0.42) =>
  s <= at ? 0 : back((s - at) / duration, strength);
/** press: провал на `depth` по полусинусу за 0,25 с. */
const press = (s: number, at: number, depth = 0.06) =>
  1 - depth * Math.sin(Math.PI * clamp((s - at) / 0.25));

/** Строка поднимается на 18 px из размытия; полностью видна на 62,5 % пути. */
function rise(
  g: CanvasRenderingContext2D,
  s: number,
  at: number,
  draw: () => void,
  duration = 0.34,
) {
  const p = clamp((s - at) / duration);
  if (p <= 0) return;
  const k = outExpo(p);
  g.save();
  g.globalAlpha *= clamp(p / 0.625);
  g.translate(0, 18 * (1 - k));
  if (p < 1) g.filter = `blur(${String(Math.round(4 * (1 - k)))}px)`;
  draw();
  g.restore();
}

/** Масштаб вокруг точки. */
function scaleAround(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  k: number,
  draw: () => void,
) {
  if (k <= 0) return;
  g.save();
  g.translate(x, y);
  g.scale(k, k);
  g.translate(-x, -y);
  draw();
  g.restore();
}

/** Кадр «живой»: сцена слегка парит по трём несоизмеримым периодам. */
function idle(t: number, phase: number) {
  const base = (2 * Math.PI) / 5.2;
  return {
    x: 3 * Math.sin(base * 1.31 * t + phase),
    y: 4 * Math.sin(base * t + phase * 1.7),
  };
}

/* ---------- Материал: стекло со светлой кромкой ---------- */

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function glass(
  g: CanvasRenderingContext2D,
  r: Rect,
  c: FilmPalette,
  { radius = 18, tint = 0.07, alpha = 1 } = {},
) {
  if (alpha <= 0) return;
  const rr = Math.min(radius, r.h / 2, r.w / 2);
  roundRect(g, r.x, r.y, r.w, r.h, rr);
  fill(g, c.paper, tint * alpha);
  // Светлая кромка сверху, к низу она гаснет.
  const edge = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  edge.addColorStop(0, "rgba(255,255,255,0.22)");
  edge.addColorStop(0.5, "rgba(255,255,255,0.05)");
  edge.addColorStop(1, "rgba(255,255,255,0.02)");
  g.save();
  g.globalAlpha *= alpha;
  roundRect(g, r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5, rr);
  g.strokeStyle = edge;
  g.lineWidth = 1.5;
  g.stroke();
  g.restore();
}

/** Блик проходит по карточке слева направо за `duration` секунд. */
function shimmer(
  g: CanvasRenderingContext2D,
  r: Rect,
  s: number,
  at: number,
  duration: number,
) {
  const p = (s - at) / duration;
  if (p <= 0 || p >= 1) return;
  const x = lerp(r.x - 160, r.x + r.w + 160, smootherstep(p));
  g.save();
  roundRect(g, r.x, r.y, r.w, r.h, 18);
  g.clip();
  const band = g.createLinearGradient(x - 120, 0, x + 120, 0);
  band.addColorStop(0, "rgba(255,255,255,0)");
  band.addColorStop(0.5, "rgba(255,255,255,0.09)");
  band.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = band;
  g.fillRect(r.x, r.y, r.w, r.h);
  g.restore();
}

/** Агент: светлый кружок с логотипом. */
function agentOrb(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  c: FilmPalette,
  agent: AgentId,
) {
  if (r <= 0) return;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  fill(g, c.paper);
  logo(g, agent, x, y, r * 1.1, 1);
}

interface Scene {
  readonly g: CanvasRenderingContext2D;
  /** Время внутри сцены. */
  readonly s: number;
  /** Время фильма: для «живого» парения. */
  readonly t: number;
  readonly f: FilmFonts;
  readonly c: FilmPalette;
}

/* ---------- 1. Разработка с агентом ---------- */

const PROMPT = "Добавь вход через GitHub";
const TYPE_AT = 0.35;
/** Печать по символу: 50 мс на символ, символ появляется целиком. */
const TYPE_STEP = 0.05;
const SEND = 1.75;
const BAR: Rect = { x: LEFT, y: TOP + 40, w: INNER, h: 88 };
const SEND_AT = { x: BAR.x + BAR.w - 42, y: BAR.y + BAR.h / 2, r: 26 };
const STEPS = [
  ["План", "spec.md"],
  ["Код", "+124 −8"],
  ["Проверки", "24/24"],
] as const;

function sceneDevelop({ g, s, t, f, c }: Scene) {
  const float = idle(t, 0.2);
  g.save();
  g.translate(float.x, float.y);
  glass(g, BAR, c, { radius: 44, tint: 0.08 });
  const mid = BAR.y + BAR.h / 2;
  logo(g, "claude", BAR.x + 40, mid, 36, 1);
  const typed = Math.max(
    0,
    Math.min(PROMPT.length, Math.floor((s - TYPE_AT) / TYPE_STEP)),
  );
  const shown = PROMPT.slice(0, typed);
  text(g, shown, BAR.x + 76, mid, 34, 600, c.paper, f.sans);
  if (s < SEND && (typed < PROMPT.length || Math.floor(s * 3) % 2 === 0)) {
    const caret = BAR.x + 76 + width(g, shown, `600 34px ${f.sans}`) + 5;
    g.fillStyle = c.accent;
    g.fillRect(caret, mid - 20, 3, 40);
  }
  // Отправка: кнопка проседает на 8 %, стрелка улетает вверх и гаснет.
  const sent = s >= SEND;
  const dip = press(s, SEND, 0.08);
  g.beginPath();
  g.arc(SEND_AT.x, SEND_AT.y, SEND_AT.r * dip, 0, Math.PI * 2);
  fill(g, sent ? c.accent : c.paper, sent ? 1 : 0.14);
  const fly = sent ? outExpo((s - SEND) / 0.5) : 0;
  g.save();
  g.globalAlpha *= 1 - fly;
  g.translate(SEND_AT.x, SEND_AT.y - 24 * fly);
  g.strokeStyle = c.paper;
  g.lineWidth = 3.5;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  g.moveTo(0, 10);
  g.lineTo(0, -10);
  g.moveTo(-8, -2);
  g.lineTo(0, -10);
  g.lineTo(8, -2);
  g.stroke();
  g.restore();
  // Шаги работы агента поднимаются каскадом, галочки выскакивают с перелётом.
  for (const [i, [label, value]] of STEPS.entries()) {
    const at = 2.0 + i * 0.12;
    const y = TOP + 202 + i * 80;
    rise(g, s, at, () => {
      scaleAround(g, LEFT + 20, y, pop(s, at + 0.12), () => {
        done(g, LEFT + 20, y, 1, c);
      });
      text(g, label, LEFT + 60, y, 34, 650, c.paper, f.sans);
      text(g, value, RIGHT, y, 30, 600, c.paper, f.mono, {
        align: "right",
        alpha: 0.6,
      });
    });
  }
  g.restore();
  // Курсор подходит медленно-быстро-медленно, нажимает и отпускает с отскоком.
  const approach = smootherstep((s - 1.2) / 0.45);
  const away = smootherstep((s - 2.05) / 0.5);
  const x = lerp(SEND_AT.x + 110, SEND_AT.x + 6, approach) + 90 * away;
  const y = lerp(SEND_AT.y + 230, SEND_AT.y + 8, approach) + 160 * away;
  const pressing = s >= SEND && s < SEND + 0.16 ? (s - SEND) / 0.16 : 0;
  cursor(g, x, y, clamp((s - 1.15) / 0.15) * (1 - away), pressing, c);
}

/* ---------- 2. Harness и контекст ---------- */

const FILE_W = 330;
const FILES = [
  ["AGENTS.md", 4, true],
  ["skills/", 6, true],
  ["docs/auth.md", 8, true],
  ["legacy/", 0, false],
] as const;
const fileRect = (i: number): Rect => ({
  x: LEFT,
  y: TOP + 50 + i * 100,
  w: FILE_W,
  h: 80,
});
const CONTEXT: Rect = {
  x: LEFT + FILE_W + 60,
  y: TOP + 50,
  w: INNER - FILE_W - 60,
  h: 380,
};
const slotRect = (i: number): Rect => ({
  x: CONTEXT.x + 20,
  y: CONTEXT.y + 76 + i * 66,
  w: CONTEXT.w - 40,
  h: 50,
});
/** Бросок по дуге: 0,55 с, подъём дуги 40 px, рост ×1,08 в середине пути. */
const THROW = 0.55;
const throwAt = (i: number) => 0.6 + i * 0.38;

function sceneContext({ g, s, t, f, c }: Scene) {
  const float = idle(t, 1.1);
  g.save();
  g.translate(float.x, float.y);
  // Окно контекста отвечает провалом на каждое приземление.
  const landings = [0, 1, 2].map((i) => throwAt(i) + THROW);
  const dip = landings.reduce((k, at) => k * press(s, at, 0.035), 1);
  scaleAround(
    g,
    CONTEXT.x + CONTEXT.w / 2,
    CONTEXT.y + CONTEXT.h / 2,
    arrive(s, 0) * dip,
    () => {
      glass(g, CONTEXT, c, { tint: 0.05 });
      text(
        g,
        "Контекст",
        CONTEXT.x + 24,
        CONTEXT.y + 36,
        30,
        650,
        c.paper,
        f.sans,
      );
    },
  );
  scaleAround(g, RIGHT - 4, CONTEXT.y, pop(s, 0.25), () => {
    agentOrb(g, RIGHT - 4, CONTEXT.y, 34, c, "claude");
  });
  let tokens = 0;
  let slot = 0;
  for (const [i, [name, size, read]] of FILES.entries()) {
    const r = fileRect(i);
    const y = r.y + r.h / 2;
    scaleAround(g, r.x + r.w / 2, y, arrive(s, 0.05 + i * 0.09), () => {
      glass(g, r, c);
      const thrown = read ? clamp((s - throwAt(slot) - THROW) / 0.2) : 0;
      g.beginPath();
      g.arc(r.x + 26, y, 7, 0, Math.PI * 2);
      fill(g, read ? c.accent : c.paper, read ? 0.35 + 0.65 * thrown : 0.25);
      text(g, name, r.x + 48, y + 1, 30, 600, c.paper, f.mono, {
        alpha: read ? 1 : 0.4,
      });
      if (!read) {
        const cross = smootherstep((s - 1.95) / 0.3);
        if (cross > 0) {
          g.save();
          g.globalAlpha *= 0.65;
          g.strokeStyle = c.paper;
          g.lineWidth = 2.5;
          g.beginPath();
          g.moveTo(r.x + 44, y);
          g.lineTo(
            r.x + 44 + (width(g, name, `600 30px ${f.mono}`) + 8) * cross,
            y,
          );
          g.stroke();
          g.restore();
        }
      }
    });
    if (!read) continue;
    // Копия файла летит по дуге в окно контекста и встаёт строкой.
    const at = throwAt(slot);
    const p = clamp((s - at) / THROW);
    if (s >= at) {
      const target = slotRect(slot);
      const k = smootherstep(p);
      const x = lerp(r.x, target.x, k);
      const top = lerp(r.y, target.y, k) - 40 * Math.sin(Math.PI * p);
      const w = lerp(r.w, target.w, k);
      const h = lerp(r.h, target.h, k);
      const grow = 1 + 0.08 * Math.sin(Math.PI * p);
      scaleAround(g, x + w / 2, top + h / 2, grow, () => {
        const away = clamp((p - 0.3) / 0.3);
        glass(g, { x, y: top, w, h }, c, {
          radius: 14,
          tint: 0.12,
          alpha: away,
        });
        text(g, name, x + 20, top + h / 2 + 1, 28, 600, c.paper, f.mono, {
          alpha: away,
        });
        if (p >= 1) {
          scaleAround(
            g,
            x + w - 30,
            top + h / 2,
            pop(s, at + THROW, 1.7, 0.35),
            () => {
              text(
                g,
                `${String(size)}k`,
                x + w - 18,
                top + h / 2 + 1,
                26,
                700,
                c.accent,
                f.mono,
                {
                  align: "right",
                },
              );
            },
          );
        }
      });
      tokens += size * clamp((s - at - THROW) / 0.15);
    }
    slot += 1;
  }
  text(
    g,
    `${String(Math.round(tokens))}k / 200k`,
    CONTEXT.x + CONTEXT.w - 24,
    CONTEXT.y + CONTEXT.h - 30,
    28,
    600,
    c.paper,
    f.mono,
    { align: "right", alpha: 0.7 * clamp(s / 0.3) },
  );
  g.restore();
}

/* ---------- 3. MCP и инструменты ---------- */

const CALLS = [
  ["github.list_repos()", "12 репозиториев", true],
  ['docs.search("вход")', "3 документа", true],
  ['db.delete_project("core")', "нет прав", false],
] as const;
const callRect = (i: number): Rect => ({
  x: LEFT + 96,
  y: TOP + 40 + i * 128,
  w: INNER - 96,
  h: 112,
});

function sceneTools({ g, s, t, f, c }: Scene) {
  const float = idle(t, 2.3);
  g.save();
  g.translate(float.x, float.y);
  scaleAround(g, LEFT + 34, TOP + 80, pop(s, 0.1), () => {
    agentOrb(g, LEFT + 34, TOP + 80, 34, c, "codex");
  });
  for (const [i, [call, result, allowed]] of CALLS.entries()) {
    const r = callRect(i);
    const at = 0.2 + i * 0.5;
    const answered = s - (at + 0.35);
    // Отказ: карточка вздрагивает и затухает к покою.
    const shake =
      !allowed && answered > 0
        ? Math.sin(answered * 42) * 7 * Math.max(0, 1 - answered / 0.45)
        : 0;
    scaleAround(g, r.x + r.w / 2, r.y + r.h / 2, arrive(s, at - 0.1), () => {
      g.save();
      g.translate(shake, 0);
      glass(g, r, c);
      rise(g, s, at, () => {
        text(g, "→", r.x + 26, r.y + 34, 30, 700, c.accent, f.mono);
        text(g, call, r.x + 62, r.y + 35, 30, 600, c.paper, f.mono);
      });
      if (answered > 0) {
        const ry = r.y + r.h - 32;
        scaleAround(g, r.x + 74, ry, pop(s, at + 0.35), () => {
          if (allowed) done(g, r.x + 74, ry, 1, c);
          else {
            g.beginPath();
            g.arc(r.x + 74, ry, 20, 0, Math.PI * 2);
            fill(g, c.accent);
          }
        });
        rise(g, s, at + 0.42, () => {
          text(
            g,
            result,
            r.x + 108,
            ry + 1,
            30,
            650,
            allowed ? c.paper : c.accent,
            f.sans,
          );
        });
      }
      g.restore();
    });
  }
  g.restore();
}

/* ---------- 4. RAG по документам ---------- */

const QUESTION: Rect = { x: RIGHT - 380, y: TOP + 40, w: 380, h: 76 };
const SOURCES: readonly Rect[] = [
  { x: LEFT, y: TOP + 150, w: 330, h: 60 },
  { x: LEFT + 346, y: TOP + 150, w: 300, h: 60 },
];
const ANSWER: Rect = { x: LEFT, y: TOP + 236, w: INNER, h: 170 };
const LINES = [
  ["Вход идёт через GitHub OAuth ", "[1]"],
  ["Сессия живёт 30 дней ", "[2]"],
] as const;

/** Ответ идёт потоком: мягкий край шириной около четырёх символов бежит впереди текста. */
function stream(
  g: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color: string,
  family: string,
  p: number,
) {
  if (p <= 0) return;
  const full = width(g, value, `600 ${String(size)}px ${family}`);
  const edge = size * 2.2;
  const head = lerp(0, full + edge, clamp(p));
  const slices = 6;
  // Твёрдая часть до края, затем край тонкими полосами с убывающей прозрачностью.
  const solid = Math.max(0, head - edge);
  for (let i = -1; i < slices; i++) {
    const from = i < 0 ? -4 : solid + (edge * i) / slices;
    const to = i < 0 ? solid : solid + (edge * (i + 1)) / slices;
    if (to <= from) continue;
    g.save();
    g.beginPath();
    g.rect(x + from, y - size, to - from, size * 2);
    g.clip();
    text(g, value, x, y, size, 600, color, family, {
      alpha: i < 0 ? 1 : 1 - (i + 0.5) / slices,
    });
    g.restore();
  }
}

function sceneRag({ g, s, t, f, c }: Scene) {
  const float = idle(t, 3.4);
  g.save();
  g.translate(float.x, float.y);
  // Сначала появляется тот, кто спрашивает, следом — пузырь вопроса.
  scaleAround(g, 96, TOP + 78, pop(s, 0.15), () => {
    agentOrb(g, 96, TOP + 78, 32, c, "deepseek");
  });
  scaleAround(
    g,
    QUESTION.x + QUESTION.w,
    QUESTION.y + QUESTION.h / 2,
    arrive(s, 0.25, 1.7, 0.5),
    () => {
      roundRect(
        g,
        QUESTION.x,
        QUESTION.y,
        QUESTION.w,
        QUESTION.h,
        QUESTION.h / 2,
      );
      fill(g, c.accent);
      text(
        g,
        "Как устроен вход?",
        QUESTION.x + QUESTION.w / 2,
        QUESTION.y + QUESTION.h / 2 + 1,
        34,
        650,
        c.paper,
        f.sans,
        {
          align: "center",
        },
      );
    },
  );
  for (const [i, r] of SOURCES.entries()) {
    scaleAround(g, r.x + r.w / 2, r.y + r.h / 2, pop(s, 0.55 + i * 0.1), () => {
      glass(g, r, c, { tint: 0.12 });
      text(
        g,
        i === 0 ? "[1] docs/auth.md" : "[2] adr-012.md",
        r.x + 22,
        r.y + r.h / 2 + 1,
        28,
        600,
        c.paper,
        f.mono,
      );
    });
  }
  scaleAround(
    g,
    ANSWER.x + ANSWER.w / 2,
    ANSWER.y + ANSWER.h / 2,
    arrive(s, 0.75),
    () => {
      glass(g, ANSWER, c, { tint: 0.06 });
    },
  );
  for (const [i, [line, ref]] of LINES.entries()) {
    const y = ANSWER.y + 52 + i * 64;
    const at = 0.95 + i * 0.45;
    stream(g, line, ANSWER.x + 28, y, 34, c.paper, f.sans, (s - at) / 0.6);
    const w = width(g, line, `600 34px ${f.sans}`);
    scaleAround(g, ANSWER.x + 28 + w + 18, y, pop(s, at + 0.7), () => {
      text(g, ref, ANSWER.x + 28 + w, y, 30, 700, c.accent, f.mono);
    });
  }
  shimmer(g, ANSWER, s, 1.95, 0.7);
  g.restore();
}

/* ---------- 5. Параллельные агенты ---------- */

const LANES = [
  ["Пишет код", "auth/github.ts", "claude", 0.45, 1.3],
  ["Пишет тесты", "", "codex", 0.6, 1.6],
  ["Делает ревью", "PR #42", "deepseek", 1.05, 1.0],
] as const;
const laneRect = (i: number): Rect => ({
  x: 200,
  y: TOP + 30 + i * 140,
  w: RIGHT - 200,
  h: 112,
});

function sceneParallel({ g, s, t, f, c }: Scene) {
  for (const [i, [role, task, agent, start, length]] of LANES.entries()) {
    // Каждая плашка парит в своей фазе: соседи не дёргаются вместе.
    const float = idle(t, 4.1 + i * 1.3);
    const r = laneRect(i);
    const oy = r.y + 56;
    g.save();
    g.translate(float.x, float.y);
    scaleAround(g, 112, oy, pop(s, 0.1 + i * 0.12), () => {
      agentOrb(g, 112, oy, 38, c, agent);
    });
    const p = smootherstep((s - start) / length);
    const finished = clamp((s - start - length) / 0.2);
    if (p > 0 && finished < 1) {
      g.save();
      g.globalAlpha *= 1 - finished;
      g.strokeStyle = c.paper;
      g.lineWidth = 3;
      g.beginPath();
      const spin = t * 6 + i;
      g.arc(112, oy, 46, spin, spin + Math.PI * 0.6);
      g.stroke();
      g.restore();
    }
    scaleAround(
      g,
      r.x + r.w / 2,
      r.y + r.h / 2,
      arrive(s, 0.15 + i * 0.12),
      () => {
        glass(g, r, c);
        const y = r.y + r.h / 2 - 6;
        text(g, role, r.x + 28, y, 32, 650, c.paper, f.sans);
        const right = r.x + r.w - 28;
        const status = i === 1 ? `${String(Math.round(24 * p))}/24` : task;
        text(g, status, right - 46 * finished, y, 28, 600, c.paper, f.mono, {
          align: "right",
          alpha: 0.65,
        });
        scaleAround(g, right - 14, y, pop(s, start + length), () => {
          done(g, right - 14, y, 1, c);
        });
        const track = r.w - 56;
        roundRect(g, r.x + 28, r.y + r.h - 18, track, 6, 3);
        fill(g, c.paper, 0.1);
        roundRect(g, r.x + 28, r.y + r.h - 18, Math.max(6, track * p), 6, 3);
        fill(g, c.accent);
      },
    );
    g.restore();
  }
}

/* ---------- 6. Evals перед релизом ---------- */

const SCORES = [
  ["v1", 0.82, false],
  ["v2", 0.91, true],
] as const;
const barRect = (i: number): Rect => ({
  x: 150,
  y: TOP + 170 + i * 80,
  w: RIGHT - 120 - 150,
  h: 32,
});

function sceneEvals({ g, s, t, f, c }: Scene) {
  const float = idle(t, 5.2);
  g.save();
  g.translate(float.x, float.y);
  scaleAround(g, 96, TOP + 78, pop(s, 0.1), () => {
    agentOrb(g, 96, TOP + 78, 32, c, "codex");
  });
  const tag: Rect = { x: RIGHT - 250, y: TOP + 50, w: 250, h: 56 };
  scaleAround(g, tag.x + tag.w / 2, tag.y + tag.h / 2, pop(s, 0.15), () => {
    glass(g, tag, c, { radius: 28, tint: 0.08 });
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
        alpha: 0.85,
      },
    );
  });
  for (const [i, [name, score, best]] of SCORES.entries()) {
    const r = barRect(i);
    const y = r.y + r.h / 2;
    // График растёт одним плавным движением, без остановок.
    const grow = smootherstep((s - (0.4 + i * 0.25)) / 0.85);
    rise(g, s, 0.1 + i * 0.09, () => {
      text(g, name, LEFT, y, 34, 700, c.paper, f.mono);
      roundRect(g, r.x, r.y, r.w, r.h, 16);
      fill(g, c.paper, 0.08);
      roundRect(g, r.x, r.y, Math.max(r.h, r.w * score * grow), r.h, 16);
      fill(g, best ? c.accent : c.paper, best ? 1 : 0.35);
      if (!best) {
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
            alpha: 0.7,
          },
        );
      }
    });
    if (best) {
      // Итоговый балл подчёркнут чипом, который выскакивает в конце роста.
      const chip: Rect = { x: RIGHT - 96, y: y - 24, w: 96, h: 48 };
      const value = `${String(Math.round(score * 100 * grow))}%`;
      const chipIn = pop(s, 1.45, 1.7, 0.4);
      if (chipIn > 0) {
        scaleAround(g, chip.x + chip.w / 2, y, chipIn, () => {
          roundRect(g, chip.x, chip.y, chip.w, chip.h, 24);
          fill(g, c.accent);
          text(g, value, chip.x + chip.w / 2, y + 1, 30, 750, c.paper, f.mono, {
            align: "center",
          });
        });
      } else {
        text(g, value, RIGHT, y, 32, 700, c.paper, f.mono, { align: "right" });
      }
    }
  }
  rise(g, s, 1.6, () => {
    const ry = TOP + 372;
    scaleAround(g, LEFT + 20, ry, pop(s, 1.7), () => {
      done(g, LEFT + 20, ry, 1, c);
    });
    text(
      g,
      "v2 лучше — можно в релиз",
      LEFT + 60,
      ry + 1,
      34,
      650,
      c.paper,
      f.sans,
    );
  });
  g.restore();
}

/* ---------- Монтаж: сцены и склейки ---------- */

type Draw = (scene: Scene) => void;
type Cut = "aperture" | "motion-left" | "motion-up" | "world-pan";
interface Shot {
  readonly start: number;
  /**
   * Часы сцены идут раньше склейки на `lead` секунд: к кадру склейки её карточки уже стоят,
   * и кадр склейки не бывает пустым.
   */
  readonly lead: number;
  readonly draw: Draw;
  /** Как эта сцена уходит в следующую. */
  readonly cut: Cut;
}

const SHOTS: readonly Shot[] = [
  { start: 0, lead: 0, draw: sceneDevelop, cut: "aperture" },
  { start: 4, lead: 0.6, draw: sceneContext, cut: "motion-left" },
  { start: 7, lead: 0.6, draw: sceneTools, cut: "world-pan" },
  { start: 10, lead: 0.6, draw: sceneRag, cut: "motion-up" },
  { start: 13, lead: 0.6, draw: sceneParallel, cut: "motion-left" },
  { start: 16.2, lead: 0.6, draw: sceneEvals, cut: "motion-left" },
];

/** Сдвиг уходящей сцены motion-cut: дрейф 20 px за 0,6 с, затем уход 460 px по u^2.6 за 0,3 с. */
function motionOut(t: number, cut: number) {
  const q = (t - (cut - 0.9)) / 0.6;
  const drift = q > 0 ? 20 * q * q : 0;
  return drift + 460 * accel((t - (cut - 0.3)) / 0.3);
}
/** Сдвиг входящей сцены: с 300 px по out-expo за 0,5 с и хвост 16 px за 1,2 с. */
function motionIn(t: number, cut: number) {
  const p = (t - cut) / 0.5;
  return (
    300 * 2 ** (-10 * clamp(p)) * (p < 1 ? 1 : 0) +
    16 * (1 - restExpo((t - cut) / 1.2))
  );
}
function drawShot(
  g: CanvasRenderingContext2D,
  shot: Shot,
  t: number,
  fonts: FilmFonts,
  c: FilmPalette,
) {
  shot.draw({ g, s: t - shot.start + shot.lead, t, f: fonts, c });
}

function withOffset(
  g: CanvasRenderingContext2D,
  dx: number,
  dy: number,
  draw: () => void,
) {
  g.save();
  g.translate(dx, dy);
  draw();
  g.restore();
}

export function drawFilmV3(
  g: CanvasRenderingContext2D,
  time: number,
  fonts: FilmFonts,
  palette: FilmPalette = DEFAULT_PALETTE,
) {
  const t = ((time % FILM_V3_DURATION) + FILM_V3_DURATION) % FILM_V3_DURATION;
  const c = palette;
  g.fillStyle = c.ink;
  g.fillRect(0, 0, W, H);

  const index = SHOTS.findLastIndex((shot) => t >= shot.start);
  const shot = SHOTS[index];
  if (!shot) return;
  const nextStart = SHOTS[index + 1]?.start ?? FILM_V3_DURATION;
  const previous = SHOTS[index - 1] ?? SHOTS[SHOTS.length - 1];
  // Вход текущей сцены определяет склейка предыдущей (для первой — шов цикла).
  const enteredBy =
    index === 0 ? "motion-left" : (previous?.cut ?? "motion-left");
  const since = t - shot.start;

  // world-pan: две сцены в одном мире, камера едет вниз с лёгким отъездом.
  if (shot.cut === "world-pan" && t >= nextStart - 0.35) {
    const next = SHOTS[index + 1];
    const u = (t - (nextStart - 0.35)) / 0.35;
    const cam = 0.44 * accel(u) * H;
    const zoom = 1 - 0.175 * accel(u);
    scaleAround(g, CX, CY, zoom, () => {
      g.save();
      g.translate(0, -cam);
      drawShot(g, shot, t, fonts, c);
      g.translate(0, H);
      if (next) drawShot(g, next, t, fonts, c);
      g.restore();
    });
    return;
  }
  if (enteredBy === "world-pan" && since < 1.2) {
    const v = since / 1.2;
    const cam = (0.44 + 0.56 * restExpo(v)) * H;
    const zoom =
      since < 0.4
        ? lerp(0.825, 0.75, smootherstep(since / 0.4))
        : lerp(0.75, 1, smootherstep((since - 0.4) / 0.8));
    scaleAround(g, CX, CY, zoom, () => {
      g.save();
      g.translate(0, H - cam);
      drawShot(g, shot, t, fonts, c);
      if (previous) {
        g.translate(0, -H);
        drawShot(g, previous, t, fonts, c);
      }
      g.restore();
    });
    return;
  }

  // aperture-cut: камера влетает в кнопку отправки, внутри уже видна следующая сцена.
  if (shot.cut === "aperture" && t >= nextStart - 0.9) {
    const next = SHOTS[index + 1];
    const prep = clamp((t - (nextStart - 0.9)) / 0.6);
    const u = clamp((t - (nextStart - 0.3)) / 0.3);
    const k = accel(u);
    const cover = (Math.hypot(W, H) / 2 / SEND_AT.r) * 1.02;
    const zoom = lerp(1 + 0.025 * prep * prep, cover, k);
    const x = lerp(SEND_AT.x, CX, k);
    const y = lerp(SEND_AT.y, CY, k);
    g.save();
    g.translate(x, y);
    g.scale(zoom, zoom);
    g.translate(-SEND_AT.x, -SEND_AT.y);
    if (k > 0.05)
      g.filter = `blur(${String(Math.round(Math.min(12, 16 * k)))}px)`;
    drawShot(g, shot, t, fonts, c);
    g.restore();
    const reveal = smootherstep((u - 0.25) / 0.35);
    if (next && reveal > 0) {
      g.save();
      g.beginPath();
      g.arc(x, y, SEND_AT.r * zoom, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = c.ink;
      g.fillRect(0, 0, W, H);
      g.globalAlpha *= reveal;
      scaleAround(g, CX, CY, 1.12, () => {
        drawShot(g, next, t, fonts, c);
      });
      g.restore();
    }
    return;
  }
  if (enteredBy === "aperture" && since < 1.2) {
    const settle =
      1 +
      0.101 * 2 ** (-10 * clamp(since / 0.5)) +
      0.019 * (1 - restExpo(since / 1.2));
    scaleAround(g, CX, CY, settle, () => {
      drawShot(g, shot, t, fonts, c);
    });
    return;
  }

  // motion-cut: уход с разгоном, вход в том же направлении.
  const vertical = (cut: Cut) => cut === "motion-up";
  if (
    (shot.cut === "motion-left" || shot.cut === "motion-up") &&
    t >= nextStart - 0.9
  ) {
    const d = motionOut(t, nextStart);
    withOffset(
      g,
      vertical(shot.cut) ? 0 : -d,
      vertical(shot.cut) ? -d : 0,
      () => {
        drawShot(g, shot, t, fonts, c);
      },
    );
    return;
  }
  if (
    (enteredBy === "motion-left" || enteredBy === "motion-up") &&
    since < 1.2
  ) {
    const d = motionIn(t, shot.start);
    withOffset(
      g,
      vertical(enteredBy) ? 0 : d,
      vertical(enteredBy) ? d : 0,
      () => {
        drawShot(g, shot, t, fonts, c);
      },
    );
    return;
  }
  drawShot(g, shot, t, fonts, c);
}

/** Текстовый эквивалент для скринридера: то же, что показывает анимация. */
export const FILM_V3_DESCRIPTION =
  "Анимация курса: навыки AI-инженера. Агент получает задачу «Добавь вход через GitHub» и готовит план, код и проверки. Нужные файлы проекта копиями летят в контекст агента, ненужный зачёркнут; контекст занят на 18 тысяч токенов из 200. Через MCP агент вызывает разрешённые инструменты, к удалению проекта прав нет. Агент отвечает на вопрос о входе со ссылками на документы. Три агента параллельно пишут код, тесты и делают ревью. Evals показывают, что новая версия агента лучше старой: 91 % против 82 %, её можно выпускать.";
