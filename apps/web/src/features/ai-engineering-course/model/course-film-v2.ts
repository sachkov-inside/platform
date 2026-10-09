/**
 * Вторая версия анимации курса: путь одной фичи от задачи до релиза. Задача, контекст, карта
 * вопросов, две спецификации, задачи, агенты с инструментами MCP и артефактами, тесты и ревью
 * агентом, ревью человеком, merge, деплой и фича у пользователей. Кадр — чистая функция времени.
 *
 * Переходы нарочно разные: поле ввода перетекает в агента, файлы влетают в агента и исчезают в
 * нём, вопросы выходят из агента и сворачиваются обратно, из агента раскрываются спецификации,
 * спецификации делятся на задачи, задачи сходятся стопкой в pull request, pull request улетает
 * вверх, деплой поднимается снизу и уходит смахиванием, релиз медленно гаснет в начало цикла.
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
  roundRect,
  spring,
  text,
  track,
  width,
  type FilmFonts,
  type FilmPalette,
} from "./film-kit";

export const FILM_V2_DURATION = 24;
/** Итоговый кадр для reduced motion: фича вышла, у пользователя новая кнопка входа. */
export const FILM_V2_POSTER_TIME = 22.4;

const CX = FILM_WIDTH / 2;
const CY = FILM_HEIGHT / 2;

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
const mix = (a: Rect, b: Rect, k: number): Rect => ({
  x: lerp(a.x, b.x, k),
  y: lerp(a.y, b.y, k),
  w: lerp(a.w, b.w, k),
  h: lerp(a.h, b.h, k),
});
/** Ускорение к концу: для ухода и сворачивания. */
const easeIn = (x: number) => clamp(x) ** 3;

interface Ctx {
  readonly g: CanvasRenderingContext2D;
  readonly t: number;
  readonly f: FilmFonts;
  readonly c: FilmPalette;
}

function card(
  g: CanvasRenderingContext2D,
  r: Rect,
  c: FilmPalette,
  alpha: number,
  paper = 0.08,
  radius = 18,
) {
  if (alpha <= 0) return;
  roundRect(g, r.x, r.y, r.w, r.h, Math.min(radius, r.h / 2, r.w / 2));
  fill(g, c.paper, alpha * paper);
}

/** Агент: светлый кружок с логотипом, при смене агента логотип перетекает. */
function orb(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  c: FilmPalette,
  alpha: number,
  agent: AgentId,
  next?: { readonly agent: AgentId; readonly k: number },
) {
  if (alpha <= 0 || r <= 0) return;
  g.save();
  g.globalAlpha *= alpha;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  fill(g, c.paper);
  const size = r * 1.1;
  if (!next || next.k <= 0) logo(g, agent, x, y, size, 1);
  else {
    logo(g, agent, x, y, size * (1 - 0.3 * next.k), 1 - next.k);
    logo(g, next.agent, x, y, size * (0.7 + 0.3 * next.k), next.k);
  }
  g.restore();
}

/* ---------- 1. Задача ---------- */

const PROMPT = "Добавь вход через GitHub";
const SEND = 1.4;
const PILL: Rect = { x: LEFT, y: CY - 44, w: INNER, h: 88 };
const ORB_AT = { x: CX, y: 250, r: 46 };
const ORB_RECT: Rect = { x: ORB_AT.x - 46, y: ORB_AT.y - 46, w: 92, h: 92 };

function sceneTask({ g, t, f, c }: Ctx) {
  // Поле ввода видно с начала цикла; в конце цикла оно снова проявляется — стык не виден.
  const back = appear(t, FILM_V2_DURATION - 0.7, 0.5);
  if (t > 2.75 && back <= 0) return;
  const morph = t < 3 ? easeOut((t - 2.15) / 0.55) : 0;
  const rect = mix(PILL, ORB_RECT, morph);
  const alpha = t < 3 ? 1 : back;
  roundRect(g, rect.x, rect.y, rect.w, rect.h, rect.h / 2);
  fill(g, c.paper, alpha * lerp(0.08, 1, morph));
  const content = t < 3 ? 1 - appear(t, 2.0, 0.15) : 0;
  if (content <= 0) return;
  const mid = PILL.y + PILL.h / 2;
  logo(g, "claude", PILL.x + 44, mid, 38, content);
  const typed = Math.floor(clamp((t - 0.3) / 0.9) * PROMPT.length);
  const shown = PROMPT.slice(0, typed);
  text(g, shown, PILL.x + 84, mid, 34, 600, c.paper, f.sans, {
    alpha: content,
  });
  if (t < SEND && (typed < PROMPT.length || Math.floor(t * 4) % 2 === 0)) {
    const caret = PILL.x + 84 + width(g, shown, `600 34px ${f.sans}`) + 5;
    g.save();
    g.globalAlpha *= content;
    g.fillStyle = c.accent;
    g.fillRect(caret, mid - 20, 3, 40);
    g.restore();
  }
  const press = clamp((t - SEND) / 0.25);
  g.beginPath();
  g.arc(
    PILL.x + PILL.w - 44,
    mid,
    28 * (1 - 0.12 * Math.sin(Math.PI * press)),
    0,
    Math.PI * 2,
  );
  fill(g, t >= SEND ? c.accent : c.paper, content * (t >= SEND ? 1 : 0.14));
}

/* ---------- 2. Контекст и 3. карта вопросов: агент в центре ---------- */

const MAP_Y = 300;
function agentCenter(t: number) {
  const down = easeOut((t - 5.0) / 0.5);
  return { x: CX, y: lerp(ORB_AT.y, MAP_Y, down) };
}

function sceneAgent({ g, t, c }: Ctx) {
  if (t < 2.6 || t > 8.3) return;
  const { x, y } = agentCenter(t);
  // Вдох агента, когда в него влетает файл.
  const pulseAt = FILES.filter(([, , , read]) => read).map(
    (_, i) => 3.45 + i * 0.3,
  );
  const beat = Math.max(
    0,
    ...pulseAt.map(
      (at) => Math.sin(Math.PI * clamp((t - at) / 0.25)) * (t >= at ? 1 : 0),
    ),
  );
  const collapse = easeIn((t - 7.85) / 0.4);
  const r = ORB_AT.r * (1 + 0.08 * beat) * (1 - 0.6 * collapse);
  orb(
    g,
    x,
    y,
    r,
    c,
    (t < 2.7 ? appear(t, 2.6, 0.1) : 1) * (1 - collapse),
    "claude",
    {
      agent: "codex",
      k: appear(t, 5.0, 0.35),
    },
  );
}

const FILES = [
  ["AGENTS.md", 170, 140, true],
  ["skills/", 790, 150, true],
  ["docs/auth.md", 160, 470, true],
  ["schema.prisma", 800, 470, true],
  ["legacy/", CX, 560, false],
] as const;
/** Файлы появляются по краям и влетают в агента; ненужный файл зачёркивается и уходит вниз. */
function sceneContext({ g, t, f, c }: Ctx) {
  if (t < 2.7 || t > 5.3) return;
  let absorbed = 0;
  let readIndex = 0;
  for (const [i, [name, fx, fy, read]] of FILES.entries()) {
    const show = 2.8 + i * 0.12;
    const pop = spring(t - show, 260, 22);
    if (pop <= 0) continue;
    const fly = read ? easeIn((t - (3.15 + readIndex * 0.3)) / 0.3) : 0;
    const w = width(g, name, `600 28px ${f.mono}`) + 44;
    const h = 56;
    const away = read ? 0 : easeIn((t - 4.5) / 0.5);
    const x = lerp(fx, ORB_AT.x, fly);
    const y = lerp(fy, ORB_AT.y, fly) + 260 * away;
    const scale = (0.6 + 0.4 * pop) * (1 - 0.85 * fly);
    const alpha = clamp(pop) * (1 - fly) * (1 - away);
    if (read) readIndex += 1;
    if (read && fly >= 1) absorbed += 1;
    if (alpha <= 0) continue;
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    card(g, { x: -w / 2, y: -h / 2, w, h }, c, alpha, 0.12, 16);
    text(g, name, 0, 1, 28, 600, c.paper, f.mono, { align: "center", alpha });
    if (!read) {
      const cross = appear(t, 4.15, 0.25);
      g.save();
      g.globalAlpha *= alpha * 0.8;
      g.strokeStyle = c.paper;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(-w / 2 + 18, 0);
      g.lineTo(-w / 2 + 18 + (w - 36) * cross, 0);
      g.stroke();
      g.restore();
    }
    g.restore();
  }
  const sizes = [4, 6, 5, 3];
  const tokens = sizes
    .slice(0, absorbed)
    .reduce((sum, value) => sum + value, 0);
  const label = `${String(tokens)}k / 200k`;
  text(g, label, ORB_AT.x, ORB_AT.y + 88, 30, 600, c.paper, f.mono, {
    align: "center",
    alpha: appear(t, 3.0, 0.3) * (1 - appear(t, 4.85, 0.25)) * 0.8,
  });
}

const QUESTIONS = [
  ["Кто входит?", "сотрудники компании", LEFT, 108],
  ["Нет аккаунта GitHub?", "вход по приглашению", RIGHT - 380, 108],
  ["Какие роли?", "две роли в проекте", LEFT, 412],
  ["Сотрудник ушёл?", "доступ отзывается", RIGHT - 380, 412],
] as const;
/** Карта вопросов: вопросы выходят из агента на свои места, ответы появляются под ними. */
function sceneMap({ g, t, f, c }: Ctx) {
  if (t < 5.2 || t > 8.3) return;
  const center = { x: CX, y: MAP_Y };
  const collapse = easeIn((t - 7.7) / 0.45);
  for (const [i, [question, answer, x, y]] of QUESTIONS.entries()) {
    const out = spring(t - (5.35 + i * 0.28), 200, 22) * (1 - collapse);
    if (out <= 0.01) continue;
    const target: Rect = { x, y, w: 380, h: 120 };
    const start: Rect = { x: center.x - 30, y: center.y - 20, w: 60, h: 40 };
    const r = mix(start, target, out);
    const alpha = clamp(out * 1.4);
    card(g, r, c, alpha, 0.1);
    const inside = clamp((out - 0.6) / 0.4);
    text(g, question, r.x + 24, r.y + 40, 30, 700, c.paper, f.sans, {
      alpha: inside,
    });
    const answered = appear(t, 5.9 + i * 0.28, 0.3) * inside;
    if (answered > 0) {
      done(g, r.x + 40, r.y + 84, answered, c);
      text(g, answer, r.x + 70, r.y + 85, 28, 600, c.paper, f.sans, {
        alpha: answered * 0.85,
      });
    }
  }
}

/* ---------- 4. Спецификации и 5–6. задачи с агентами ---------- */

const DOCS: readonly Rect[] = [
  { x: LEFT, y: 100, w: 400, h: 420 },
  { x: RIGHT - 400, y: 100, w: 400, h: 420 },
];
const DOC_NAMES = ["spec · вход.md", "spec · доступ.md"] as const;
const DOC_CRITERIA = [
  ["вход по приглашению", "сессия 30 дней"],
  ["две роли в проекте", "отзыв доступа"],
] as const;
const SPLIT = 10.4;
/** Спецификации раскрываются из агента, пишутся строками, критерии отмечаются. */
function sceneSpecs({ g, t, f, c }: Ctx) {
  if (t < 7.95 || t > SPLIT + 0.2) return;
  for (const [i, doc] of DOCS.entries()) {
    const open = spring(t - (8.0 + i * 0.12), 200, 24);
    const r = mix({ x: CX - 20, y: MAP_Y - 20, w: 40, h: 40 }, doc, open);
    const fade = 1 - appear(t, SPLIT - 0.15, 0.15);
    card(g, r, c, clamp(open * 1.5), 0.08);
    const a = clamp((open - 0.7) / 0.3) * fade;
    if (a <= 0) continue;
    text(g, DOC_NAMES[i] ?? "", r.x + 28, r.y + 44, 28, 600, c.accent, f.mono, {
      alpha: a,
    });
    // Строки спецификации пишутся слева направо.
    const rows = [0.92, 0.7, 0.84, 0.55];
    for (const [j, share] of rows.entries()) {
      const k = easeOut((t - (8.55 + i * 0.15 + j * 0.16)) / 0.3);
      roundRect(g, r.x + 28, r.y + 88 + j * 34, (r.w - 56) * share * k, 12, 6);
      fill(g, c.paper, a * 0.22);
    }
    for (const [j, criterion] of (DOC_CRITERIA[i] ?? []).entries()) {
      const y = r.y + 276 + j * 56;
      const ok = appear(t, 9.35 + i * 0.2 + j * 0.25, 0.3);
      done(g, r.x + 48, y, ok * a, c);
      text(g, criterion, r.x + 80, y + 1, 28, 600, c.paper, f.sans, {
        alpha: a * (0.5 + 0.5 * ok),
      });
    }
  }
}

const TASKS = [
  ["#12 OAuth-вход", "claude", "MCP · github", "+86 −4", 1.5],
  ["#13 Сессия", "codex", "MCP · postgres", "миграция", 1.9],
  ["#14 Роли в проекте", "deepseek", "playwright", "скриншот", 1.3],
  ["#15 Отзыв доступа", "claude", "MCP · docs", "ADR-013", 1.7],
] as const;
const TASK_W = (INNER - 24) / 2;
const TASK_RECTS: readonly Rect[] = [0, 1, 2, 3].map((i) => ({
  x: LEFT + (i % 2) * (TASK_W + 24),
  y: 120 + Math.floor(i / 2) * 200,
  w: TASK_W,
  h: 176,
}));
const RUN = 12.5;
const STACK = 15.6;
const PR: Rect = { x: CX - 320, y: 110, w: 640, h: 420 };

/** Каждая спецификация делится на две задачи; агенты берут задачи, вызывают инструменты. */
function sceneTasks({ g, t, f, c }: Ctx) {
  if (t < SPLIT || t > STACK + 0.7) return;
  for (const [i, [title, agent, tool, artifact, length]] of TASKS.entries()) {
    const target = TASK_RECTS[i];
    const source = DOCS[i < 2 ? 0 : 1];
    if (!target || !source) continue;
    const half: Rect =
      i % 2 === 0
        ? { ...source, h: source.h / 2 }
        : { ...source, y: source.y + source.h / 2, h: source.h / 2 };
    const split = spring(t - (SPLIT + i * 0.1), 220, 24);
    // Задачи сходятся стопкой в pull request: каждая со своим сдвигом.
    const gather = easeIn((t - (STACK + i * 0.06)) / 0.45);
    const stackRect: Rect = {
      x: PR.x + i * 6,
      y: PR.y + i * 6,
      w: PR.w,
      h: PR.h,
    };
    const r = mix(mix(half, target, split), stackRect, gather);
    card(g, r, c, 1 - 0.75 * gather, 0.08);
    const a = clamp((split - 0.6) / 0.4) * (1 - appear(t, STACK - 0.05, 0.15));
    if (a <= 0) continue;
    text(g, title, r.x + 26, r.y + 40, 30, 700, c.paper, f.sans, { alpha: a });
    const start = RUN + 0.35 + i * 0.18;
    const progress = easeOut((t - start) / length);
    if (t < RUN) {
      text(
        g,
        "готово к работе",
        r.x + 26,
        r.y + r.h - 34,
        26,
        600,
        c.paper,
        f.sans,
        {
          alpha: a * 0.55,
        },
      );
      continue;
    }
    // Агент садится на задачу.
    const sit = spring(t - (RUN + i * 0.15), 260, 20);
    orb(g, r.x + r.w - 44, r.y + 42, 26 * sit, c, a, agent);
    // Инструмент и артефакт задачи.
    const toolIn = spring(t - (start + 0.25), 260, 22);
    if (toolIn > 0) {
      const w = width(g, tool, `600 26px ${f.mono}`) + 32;
      g.save();
      g.globalAlpha *= a * clamp(toolIn);
      g.translate(r.x + 26, r.y + 78);
      g.scale(0.7 + 0.3 * toolIn, 0.7 + 0.3 * toolIn);
      card(g, { x: 0, y: 0, w, h: 40 }, c, 1, 0.12, 12);
      text(g, tool, 16, 21, 26, 600, c.paper, f.mono);
      g.restore();
    }
    const finished = appear(t, start + length, 0.25);
    if (finished > 0) {
      text(g, artifact, r.x + r.w - 26, r.y + 98, 26, 700, c.accent, f.mono, {
        align: "right",
        alpha: a * finished,
      });
    }
    const barW = r.w - 52 - 40 * finished;
    roundRect(g, r.x + 26, r.y + r.h - 34, barW, 8, 4);
    fill(g, c.paper, a * 0.1);
    roundRect(g, r.x + 26, r.y + r.h - 34, Math.max(8, barW * progress), 8, 4);
    fill(g, c.accent, a);
    done(g, r.x + r.w - 40, r.y + r.h - 30, finished * a, c);
  }
}

/* ---------- 7. Тесты и ревью агента, 8. ревью человека и merge ---------- */

const CHECKS = [
  ["Тесты", "48/48"],
  ["Линтер", "0 ошибок"],
  ["Ревью агента", "исправлено 2/2"],
] as const;
const APPROVE = 18.7;
const LAUNCH = 20.1;
const BUTTON: Rect = {
  x: PR.x + PR.w - 230,
  y: PR.y + PR.h - 92,
  w: 200,
  h: 64,
};

function scenePr({ g, t, f, c }: Ctx) {
  if (t < STACK + 0.3 || t > LAUNCH + 0.7) return;
  const appearK = appear(t, STACK + 0.35, 0.25);
  // Pull request улетает вверх, когда начинается деплой.
  const fly = easeIn((t - LAUNCH) / 0.55);
  g.save();
  g.translate(0, -720 * fly);
  g.globalAlpha *= 1 - 0.3 * fly;
  card(g, PR, c, appearK, 0.1, 22);
  const a = appear(t, STACK + 0.5, 0.25);
  text(
    g,
    "PR #42 · Вход через GitHub",
    PR.x + 32,
    PR.y + 48,
    30,
    750,
    c.paper,
    f.sans,
    {
      alpha: a,
    },
  );
  // Статус: открыт → одобрен → в main.
  const approved = appear(t, APPROVE + 0.25, 0.2);
  const merged = appear(t, APPROVE + 0.75, 0.2);
  const status = merged > 0 ? "в main" : approved > 0 ? "одобрено" : "открыт";
  const tone = merged > 0 ? c.accent : approved > 0 ? c.good : c.paper;
  const sw = width(g, status, `700 26px ${f.sans}`) + 36;
  roundRect(g, PR.x + PR.w - 32 - sw, PR.y + 28, sw, 40, 20);
  fill(g, tone, a * (approved > 0 ? 1 : 0.15));
  text(
    g,
    status,
    PR.x + PR.w - 32 - sw / 2,
    PR.y + 49,
    26,
    700,
    approved > 0 ? c.ink : c.paper,
    f.sans,
    {
      align: "center",
      alpha: a,
    },
  );
  const human = appear(t, 17.75, 0.3);
  for (const [i, [name, value]] of CHECKS.entries()) {
    const y = PR.y + 118 + i * 58;
    const ok = appear(t, 16.35 + i * 0.4, 0.3);
    const dim = 1 - 0.45 * human;
    done(g, PR.x + 52, y, ok * a, c);
    text(g, name, PR.x + 86, y + 1, 30, 650, c.paper, f.sans, {
      alpha: a * dim,
    });
    if (i === 2) {
      const after = PR.x + 86 + width(g, name, `650 30px ${f.sans}`) + 30;
      orb(g, after, y, 20, c, a * dim * ok, "deepseek");
    }
    text(g, value, PR.x + PR.w - 32, y + 1, 26, 600, c.paper, f.mono, {
      align: "right",
      alpha: a * ok * 0.7 * dim,
    });
  }
  // Ревью человека: аватар, комментарий и кнопка одобрения.
  if (human > 0) {
    const ax = PR.x + 56;
    const ay = PR.y + PR.h - 60;
    g.save();
    g.globalAlpha *= human;
    g.beginPath();
    g.arc(ax, ay, 26, 0, Math.PI * 2);
    fill(g, c.accent);
    g.beginPath();
    g.arc(ax, ay - 7, 8, 0, Math.PI * 2);
    fill(g, c.paper);
    g.beginPath();
    g.arc(ax, ay + 16, 14, Math.PI, 0);
    fill(g, c.paper);
    g.restore();
    const comment = "Проверил, всё ок";
    text(g, comment, ax + 44, ay + 1, 28, 600, c.paper, f.sans, {
      alpha: appear(t, 18.0, 0.3),
    });
    const press = clamp((t - APPROVE) / 0.3);
    const scale = 1 - 0.06 * Math.sin(Math.PI * press);
    const b = BUTTON;
    g.save();
    g.globalAlpha *= appear(t, 18.15, 0.25) * (1 - merged * 0.6);
    g.translate(b.x + b.w / 2, b.y + b.h / 2);
    g.scale(scale, scale);
    roundRect(g, -b.w / 2, -b.h / 2, b.w, b.h, 16);
    fill(g, c.paper);
    text(g, "Одобрить", 0, 2, 28, 700, c.ink, f.sans, { align: "center" });
    g.restore();
  }
  g.restore();
}

/* ---------- 9. Деплой и релиз ---------- */

const DEPLOY: Rect = { x: LEFT + 90, y: 250, w: INNER - 180, h: 120 };
const APP: Rect = { x: CX - 230, y: 96, w: 460, h: 448 };
const SHIP = 21.55;

function sceneRelease({ g, t, f, c }: Ctx) {
  if (t < LAUNCH + 0.15) return;
  // Деплой поднимается снизу, затем уходит смахиванием влево.
  const up = spring(t - (LAUNCH + 0.2), 200, 24);
  const swipe = easeIn((t - SHIP) / 0.4);
  if (swipe < 1) {
    g.save();
    g.translate(-1100 * swipe, 420 * (1 - up));
    card(g, DEPLOY, c, clamp(up * 1.4), 0.1, 22);
    text(
      g,
      "Деплой · production",
      DEPLOY.x + 32,
      DEPLOY.y + 44,
      30,
      700,
      c.paper,
      f.sans,
    );
    const p = easeOut((t - (LAUNCH + 0.45)) / 0.8);
    roundRect(g, DEPLOY.x + 32, DEPLOY.y + 82, DEPLOY.w - 120, 10, 5);
    fill(g, c.paper, 0.1);
    roundRect(
      g,
      DEPLOY.x + 32,
      DEPLOY.y + 82,
      Math.max(10, (DEPLOY.w - 120) * p),
      10,
      5,
    );
    fill(g, c.accent);
    done(
      g,
      DEPLOY.x + DEPLOY.w - 48,
      DEPLOY.y + 86,
      appear(t, LAUNCH + 1.3, 0.25),
      c,
    );
    g.restore();
  }
  // Фича у пользователей: экран приложения с новой кнопкой входа. В конце цикла он медленно гаснет.
  const pop = spring(t - (SHIP + 0.15), 180, 20);
  if (pop <= 0) return;
  const leave = easeOut((t - (FILM_V2_DURATION - 1.15)) / 0.9);
  const scale = (0.85 + 0.15 * pop) * (1 - 0.06 * leave);
  g.save();
  g.globalAlpha *= clamp(pop * 1.3) * (1 - leave);
  g.translate(CX, APP.y + APP.h / 2);
  g.scale(scale, scale);
  g.translate(-CX, -(APP.y + APP.h / 2));
  roundRect(g, APP.x, APP.y, APP.w, APP.h, 30);
  fill(g, c.paper);
  text(g, "Inside", CX, APP.y + 82, 40, 800, c.ink, f.sans, {
    align: "center",
  });
  for (const [i, share] of [0.78, 0.6].entries()) {
    roundRect(
      g,
      CX - (APP.w - 120) / 2,
      APP.y + 138 + i * 70,
      (APP.w - 120) * share + 8,
      48,
      14,
    );
    fill(g, c.ink, 0.08);
  }
  // Новая кнопка входа — та самая фича из первой сцены.
  const feature = spring(t - (SHIP + 0.5), 260, 18);
  if (feature > 0) {
    const bw = APP.w - 120;
    g.save();
    g.translate(CX, APP.y + 330);
    g.scale(0.7 + 0.3 * feature, 0.7 + 0.3 * feature);
    roundRect(g, -bw / 2, -36, bw, 72, 20);
    fill(g, c.accent, clamp(feature));
    text(g, "Войти через GitHub", 0, 2, 30, 750, c.paper, f.sans, {
      align: "center",
      alpha: clamp(feature),
    });
    g.restore();
  }
  text(g, "Релиз v1.4", CX, APP.y + APP.h - 46, 26, 700, c.ink, f.mono, {
    align: "center",
    alpha: appear(t, SHIP + 0.9, 0.3) * 0.6,
  });
  g.restore();
}

/* ---------- Курсор ---------- */

const CURSOR: readonly (readonly [number, number, number])[] = [
  [0, 990, 600],
  [0.6, PILL.x + PILL.w - 36, PILL.y + PILL.h / 2 + 10],
  [2.0, 990, 600],
  [17.9, 990, 600],
  [18.25, BUTTON.x + BUTTON.w * 0.6, BUTTON.y + BUTTON.h * 0.6],
  [19.4, 990, 600],
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
  const visible = Math.max(
    Math.min(appear(t, 0.35, 0.2), 1 - appear(t, 1.9, 0.2)),
    Math.min(appear(t, 17.95, 0.2), 1 - appear(t, 19.2, 0.2)),
  );
  let press = 0;
  for (const at of [SEND, APPROVE])
    if (t >= at && t < at + 0.35) press = (t - at) / 0.35;
  cursor(g, x, y, visible, press, c);
}

/* ---------- Кадр ---------- */

export function drawFilmV2(
  g: CanvasRenderingContext2D,
  time: number,
  fonts: FilmFonts,
  palette: FilmPalette = DEFAULT_PALETTE,
) {
  const t = ((time % FILM_V2_DURATION) + FILM_V2_DURATION) % FILM_V2_DURATION;
  const c = palette;
  g.fillStyle = c.ink;
  g.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  const frame: Ctx = { g, t, f: fonts, c };
  sceneTask(frame);
  sceneContext(frame);
  sceneMap(frame);
  sceneAgent(frame);
  sceneSpecs(frame);
  sceneTasks(frame);
  scenePr(frame);
  sceneRelease(frame);
  drawCursor(g, t, c);
}

/** Текстовый эквивалент для скринридера: то же, что показывает анимация. */
export const FILM_V2_DESCRIPTION =
  "Анимация курса: путь одной фичи. Задача «Добавь вход через GitHub» уходит агенту. Агент собирает контекст из нужных файлов проекта, ненужный пропускает. Карта вопросов: кто входит, что без аккаунта GitHub, какие роли, что при уходе сотрудника. Две спецификации с критериями делятся на четыре задачи. Агенты Claude, Codex и DeepSeek выполняют задачи через инструменты MCP и оставляют артефакты: код, миграцию, скриншот, запись решения. Pull request проходит тесты и ревью агента, человек проверяет и одобряет, изменения уходят в main. Деплой в production, и у пользователей появляется кнопка «Войти через GitHub».";
