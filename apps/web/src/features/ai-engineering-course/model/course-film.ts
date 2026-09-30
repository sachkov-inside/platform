/**
 * Анимация курса AI Engineering как чистая функция времени: `drawFilm(ctx, t)` рисует кадр для
 * любого момента без таймеров и накопленного состояния, поэтому пауза и итоговый кадр — просто
 * разные `t`. Фильм состоит из эпизодов: внутри эпизода одна тёмная форма перетекает из состояния
 * в состояние, между эпизодами карточки меняются взмахом. Курсор ведёт каждую смену.
 * Бриф и покадровый план — docs/evidence/issue-808/animation/README.md.
 */

export const FILM_WIDTH = 960;
export const FILM_HEIGHT = 640;
export const FILM_DURATION = 32;
/** Итоговый кадр для reduced motion: открыт harness проекта с пайплайном. */
export const FILM_POSTER_TIME = 9.2;

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

/* ---------- Эпизоды и состояния ---------- */

type StateId =
  | "pill"
  | "prompt"
  | "think"
  | "harness"
  | "roles"
  | "spec"
  | "features"
  | "diff"
  | "cicd"
  | "monitor"
  | "releases"
  | "toast";

interface State {
  readonly id: StateId;
  readonly at: number;
  readonly w: number;
  readonly h: number;
  readonly r: number;
}

/** Как эпизод входит и уходит: взмахом вбок, снизу или без движения (стык цикла). */
type Move = "none" | "fromRight" | "fromBottom" | "toLeft" | "toTop";

interface Episode {
  readonly start: number;
  readonly end: number;
  readonly enter: Move;
  readonly exit: Move;
  readonly states: readonly State[];
}

/**
 * Покадровый план. Каждое состояние держит результат около секунды, чтобы его успели прочитать.
 * Последний кадр равен первому: фильм кончается той же плашкой, с которой начался.
 */
const EPISODES: readonly Episode[] = [
  {
    start: 0,
    end: 6.2,
    enter: "none",
    exit: "toLeft",
    states: [
      { id: "pill", at: 0, w: 430, h: 100, r: 50 },
      { id: "prompt", at: 1.3, w: 780, h: 112, r: 56 },
      { id: "think", at: 4.4, w: 120, h: 120, r: 60 },
    ],
  },
  {
    start: 6.2,
    end: 12.8,
    enter: "fromRight",
    exit: "toTop",
    states: [
      { id: "harness", at: 6.2, w: 840, h: 480, r: 30 },
      { id: "roles", at: 9.9, w: 820, h: 420, r: 32 },
    ],
  },
  {
    start: 12.8,
    end: 21.0,
    enter: "fromBottom",
    exit: "toLeft",
    states: [
      { id: "spec", at: 12.8, w: 620, h: 430, r: 32 },
      { id: "features", at: 15.6, w: 740, h: 380, r: 32 },
      { id: "diff", at: 18.2, w: 700, h: 430, r: 30 },
    ],
  },
  {
    start: 21.0,
    end: FILM_DURATION,
    enter: "fromRight",
    exit: "none",
    states: [
      { id: "cicd", at: 21.0, w: 780, h: 350, r: 34 },
      { id: "monitor", at: 24.6, w: 760, h: 400, r: 32 },
      { id: "releases", at: 27.4, w: 620, h: 390, r: 34 },
      { id: "toast", at: 29.6, w: 620, h: 104, r: 52 },
      { id: "pill", at: 31.0, w: 430, h: 100, r: 50 },
    ],
  },
];

const CX = FILM_WIDTH / 2;
const CY = FILM_HEIGHT / 2;
/** Длительность взмаха между эпизодами. */
const SWING = 0.9;

function shape(t: number, states: readonly State[]) {
  const key = (pick: (state: State) => number) =>
    states.map((state) => [state.at, pick(state)] as const);
  return {
    w: track(
      t,
      key((s) => s.w),
      200,
      25,
    ),
    h: track(
      t,
      key((s) => s.h),
      200,
      27,
    ),
    r: track(
      t,
      key((s) => s.r),
      200,
      27,
    ),
  };
}

/** Смещение эпизода: вход пружиной из-за края, уход взмахом с лёгким поворотом. */
function placement(t: number, episode: Episode) {
  let x = 0;
  let y = 0;
  let rot = 0;
  let scale = 1;
  const enter = 1 - spring(t - episode.start, 150, 22);
  if (episode.enter === "fromRight") {
    x += 760 * enter;
    rot += 0.14 * enter;
  } else if (episode.enter === "fromBottom") {
    y += 560 * enter;
    scale -= 0.12 * enter;
  }
  const leave = clamp((t - episode.end) / SWING);
  const eased = leave * leave * (3 - 2 * leave);
  if (episode.exit === "toLeft") {
    x -= 820 * eased;
    rot -= 0.1 * eased;
  } else if (episode.exit === "toTop") {
    y -= 620 * eased;
    scale -= 0.1 * eased;
  }
  return { x, y, rot, scale };
}

/**
 * Содержимое входит после начала перетекания и уходит до следующего. Первое состояние эпизода
 * входит вместе с карточкой, последнее вместе с ней уходит, а стык цикла вовсе не гаснет.
 */
function contentAlpha(t: number, episode: Episode, index: number) {
  const state = episode.states[index];
  if (!state) return 0;
  const next = episode.states[index + 1]?.at;
  const fadeIn = index === 0 ? 1 : clamp((t - state.at - 0.16) / 0.18);
  const fadeOut = next === undefined ? 1 : clamp((next - 0.1 - t) / 0.14);
  return Math.min(fadeIn, fadeOut);
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

/** Кружок со статусом: пустой — ждёт, заполненный с галочкой — готово. */
function doneDot(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  on: number,
  radius = 16,
) {
  g.strokeStyle = on > 0 ? ACCENT_BRIGHT : MUTED;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.stroke();
  if (on <= 0) return;
  g.save();
  g.globalAlpha *= on;
  g.fillStyle = ACCENT;
  g.beginPath();
  g.arc(x, y, radius, 0, Math.PI * 2);
  g.fill();
  g.restore();
  check(g, x, y, radius, on, TEXT);
}

/** Прилёт элемента: пружиной из смещения `(dx, dy)` в своё место. */
function flyIn(
  g: CanvasRenderingContext2D,
  p: number,
  dx: number,
  dy: number,
  draw: () => void,
) {
  if (p <= 0) return;
  g.save();
  g.globalAlpha *= clamp(p * 1.6);
  g.translate(dx * (1 - p), dy * (1 - p));
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

interface Frame {
  readonly g: CanvasRenderingContext2D;
  readonly t: number;
  readonly local: number;
  readonly f: FilmFonts;
  readonly w: number;
  readonly h: number;
}

function drawPill({ g, t, f }: Frame) {
  // Период пульса делит длительность фильма: на стыке цикла точка в той же фазе.
  const pulse = 1 + 0.18 * Math.sin(2 * Math.PI * t);
  g.fillStyle = ACCENT_BRIGHT;
  g.beginPath();
  g.arc(-150, 0, 11 * pulse, 0, Math.PI * 2);
  g.fill();
  text(g, "AI Engineering", -120, 2, 40, 800, TEXT, f.sans);
}

const PROMPT = "Добавь вход через GitHub";
function drawPrompt({ g, t, f, local }: Frame) {
  const typed = Math.floor(clamp((local - 0.4) / 1.6) * PROMPT.length);
  const shown = PROMPT.slice(0, typed);
  text(g, "›", -350, 2, 44, 700, ACCENT_BRIGHT, f.sans);
  text(g, shown, -312, 2, 36, 600, TEXT, f.sans);
  const caret = -312 + width(g, shown, `600 36px ${f.sans}`) + 6;
  if (typed < PROMPT.length || Math.floor(t * 3) % 2 === 0) {
    g.fillStyle = ACCENT_BRIGHT;
    g.fillRect(caret, -20, 3, 42);
  }
  const press = clamp((local - 2.6) / 0.3);
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

function drawThink({ g, t }: Frame) {
  g.strokeStyle = ACCENT_BRIGHT;
  g.lineWidth = 7;
  g.lineCap = "round";
  const spin = t * 5;
  g.beginPath();
  g.arc(0, 0, 30, spin, spin + Math.PI * 1.3);
  g.stroke();
}

const FILES = [
  "AGENTS.md",
  "skills/",
  "roles/",
  "pipeline.yaml",
  "evals/",
] as const;
const PIPELINE = [
  "Спецификация",
  "Задачи",
  "Реализация",
  "Ревью",
  "CI/CD",
  "Deploy",
] as const;
/** Окно harness проекта: слева файлы, справа пайплайн, по которому бежит задача. */
function drawHarness({ g, f, local, w, h }: Frame) {
  const top = -h / 2;
  const left = -w / 2;
  // Строка окна: три точки и название проекта.
  for (let i = 0; i < 3; i++) {
    g.fillStyle = i === 0 ? ACCENT_BRIGHT : INK_HIGH;
    g.beginPath();
    g.arc(left + 32 + i * 22, top + 34, 7, 0, Math.PI * 2);
    g.fill();
  }
  text(g, "harness проекта", left + 110, top + 35, 28, 700, MUTED, f.sans);
  g.fillStyle = INK_LINE;
  g.fillRect(left, top + 66, w, 1.5);
  g.fillRect(left + 300, top + 66, 1.5, h - 66);
  // Файлы прилетают слева по одному; roles/ подсвечен, когда к нему идёт курсор.
  for (const [i, file] of FILES.entries()) {
    const p = spring(local - 0.35 - i * 0.14, 240, 22);
    const y = top + 112 + i * 62;
    const hot = file === "roles/" ? clamp((local - 2.5) / 0.3) : 0;
    flyIn(g, p, -120, 0, () => {
      if (hot > 0) {
        roundRect(g, left + 20, y - 24, 260, 48, 12);
        g.fillStyle = `rgba(199, 70, 30, ${String(0.35 * hot)})`;
        g.fill();
      }
      g.fillStyle = file.endsWith("/") ? ACCENT_BRIGHT : MUTED;
      g.fillRect(left + 36, y - 9, 18, 18);
      text(g, file, left + 70, y + 1, 30, 600, TEXT, f.mono);
    });
  }
  // Этапы пайплайна падают сверху, точка задачи идёт от этапа к этапу.
  const px = left + 350;
  for (const [i, stage] of PIPELINE.entries()) {
    const p = spring(local - 0.6 - i * 0.12, 240, 20);
    const y = top + 106 + i * 62;
    const passed = clamp((local - 1.3 - i * 0.32) / 0.2);
    flyIn(g, p, 0, -60, () => {
      if (i < PIPELINE.length - 1) {
        g.fillStyle = passed > 0 ? ACCENT : INK_HIGH;
        g.fillRect(px + 14, y + 16, 3, 30);
      }
      g.fillStyle = passed > 0 ? ACCENT_BRIGHT : INK_HIGH;
      g.beginPath();
      g.arc(px + 15, y, 11, 0, Math.PI * 2);
      g.fill();
      text(
        g,
        stage,
        px + 46,
        y + 1,
        30,
        700,
        passed > 0 ? TEXT : MUTED,
        f.sans,
      );
    });
  }
}

const ROLES = [
  ["Архитектор", "пишет спецификацию", -1],
  ["Разработчик", "реализует задачи", 0],
  ["Ревьюер", "проверяет PR", 1],
] as const;
/** Роли агентов прилетают с трёх сторон и встают в ряд. */
function drawRoles({ g, t, f, local, w, h }: Frame) {
  const top = -h / 2;
  text(g, "Роли агентов", -w / 2 + 44, top + 56, 34, 800, TEXT, f.sans);
  text(
    g,
    "roles/",
    w / 2 - 44,
    top + 56,
    28,
    700,
    ACCENT_BRIGHT,
    f.mono,
    "right",
  );
  const cardW = 234;
  for (const [i, [role, job, side]] of ROLES.entries()) {
    const p = spring(local - 0.35 - i * 0.2, 180, 17);
    const x = -cardW * 1.5 - 18 + i * (cardW + 18);
    flyIn(g, p, side * 260, side === 0 ? 220 : -40, () => {
      roundRect(g, x, top + 110, cardW, 250, 20);
      g.fillStyle = INK_HIGH;
      g.fill();
      const pulse = 1 + 0.15 * Math.sin(t * 6 + i);
      g.fillStyle = ACCENT_BRIGHT;
      g.beginPath();
      g.arc(x + 40, top + 160, 14 * pulse, 0, Math.PI * 2);
      g.fill();
      text(g, role, x + 24, top + 222, 30, 800, TEXT, f.sans);
      text(
        g,
        job.split(" ")[0] ?? "",
        x + 24,
        top + 272,
        26,
        600,
        MUTED,
        f.sans,
      );
      text(
        g,
        job.split(" ").slice(1).join(" "),
        x + 24,
        top + 306,
        26,
        600,
        MUTED,
        f.sans,
      );
    });
  }
}

const SPEC = [
  "Поведение",
  "Критерии приёмки",
  "API и данные",
  "Тесты",
] as const;
function drawSpec({ g, f, local, w, h }: Frame) {
  const left = -w / 2 + 44;
  const top = -h / 2;
  text(g, "Спецификация", left, top + 56, 34, 800, TEXT, f.sans);
  text(g, "вход через GitHub", left, top + 100, 28, 600, MUTED, f.sans);
  for (const [i, item] of SPEC.entries()) {
    const y = top + 172 + i * 62;
    const on = clamp((local - 0.8 - i * 0.4) / 0.28);
    const p = spring(local - 0.3 - i * 0.1, 240, 22);
    flyIn(g, p, 60, 0, () => {
      doneDot(g, left + 16, y, on);
      text(g, item, left + 52, y + 1, 30, 700, on > 0.5 ? TEXT : MUTED, f.sans);
    });
  }
}

const FEATURES = [
  ["Вход через GitHub", 1.4],
  ["Роли и доступ", 1.05],
  ["MCP-сервер", 1.25],
] as const;
function drawFeatures({ g, t, f, local, w, h }: Frame) {
  const left = -w / 2 + 44;
  const top = -h / 2;
  text(g, "Реализация фич", left, top + 56, 34, 800, TEXT, f.sans);
  text(
    g,
    "3 агента параллельно",
    w / 2 - 44,
    top + 56,
    28,
    700,
    ACCENT_BRIGHT,
    f.sans,
    "right",
  );
  for (const [i, [feature, speed]] of FEATURES.entries()) {
    const y = top + 136 + i * 76;
    const p = clamp(((local - 0.4) * speed) / 1.6);
    const enter = spring(local - 0.25 - i * 0.12, 220, 20);
    flyIn(g, enter, -80, 0, () => {
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
      text(g, feature, left + 40, y - 14, 30, 700, TEXT, f.sans);
      roundRect(g, left + 40, y + 14, w - 190, 10, 5);
      g.fillStyle = INK_HIGH;
      g.fill();
      roundRect(g, left + 40, y + 14, (w - 190) * p, 10, 5);
      g.fillStyle = p >= 1 ? ACCENT : ACCENT_BRIGHT;
      g.fill();
      if (p >= 1) {
        check(
          g,
          w / 2 - 70,
          y,
          26,
          clamp((local - 0.4 - 1.6 / speed) / 0.25),
          ACCENT_BRIGHT,
        );
      }
    });
  }
}

const DIFF = [
  ["+", "auth/github.ts", 0.9],
  ["+", "auth/session.ts", 0.7],
  ["~", "routes/login.tsx", 0.5],
  ["+", "tests/login.test.ts", 0.8],
] as const;
function drawDiff({ g, f, local, w, h }: Frame) {
  const left = -w / 2 + 44;
  const top = -h / 2;
  text(g, "Изменения", left, top + 58, 34, 800, TEXT, f.sans);
  for (const [i, [mark, file, size]] of DIFF.entries()) {
    const p = spring(local - 0.4 - i * 0.24, 240, 22);
    const y = top + 140 + i * 62;
    flyIn(g, p, 40, 0, () => {
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
    });
  }
  // Бейдж PR встаёт в шапку, когда все изменения на месте, и держится до смены эпизода.
  const pr = spring(local - 1.75, 200, 17);
  if (pr > 0) {
    g.save();
    g.translate(w / 2 - 44 - 130, top + 58);
    g.scale(0.6 + 0.4 * pr, 0.6 + 0.4 * pr);
    g.globalAlpha *= clamp(pr * 1.5);
    roundRect(g, -130, -28, 260, 56, 28);
    g.fillStyle = ACCENT;
    g.fill();
    text(g, "PR #42 открыт", 0, 1, 28, 700, TEXT, f.sans, "center");
    g.restore();
  }
}

const CICD = ["build", "tests", "deploy"] as const;
/** CI/CD: точка задачи проходит сборку, тесты и деплой, в конце — production. */
function drawCicd({ g, f, local, w, h }: Frame) {
  const left = -w / 2 + 44;
  const top = -h / 2;
  text(g, "CI/CD", left, top + 56, 34, 800, TEXT, f.sans);
  const passed = Math.round(24 * clamp((local - 1.0) / 1.2));
  text(
    g,
    `проверки ${String(passed)}/24`,
    w / 2 - 44,
    top + 56,
    28,
    700,
    passed === 24 ? ACCENT_BRIGHT : MUTED,
    f.sans,
    "right",
  );
  const y = top + 170;
  const gap = (w - 88 - 60) / (CICD.length - 1);
  const travel = clamp((local - 0.5) / 2.1);
  g.fillStyle = INK_HIGH;
  g.fillRect(left + 30, y - 3, w - 148, 6);
  g.fillStyle = ACCENT;
  g.fillRect(left + 30, y - 3, (w - 148) * travel, 6);
  for (const [i, node] of CICD.entries()) {
    const x = left + 30 + i * gap;
    const on = clamp((travel * (CICD.length - 1) - i + 0.05) / 0.1);
    doneDot(g, x, y, on, 22);
    text(
      g,
      node,
      x,
      y + 50,
      30,
      700,
      on > 0.5 ? TEXT : MUTED,
      f.mono,
      "center",
    );
  }
  const dotX = left + 30 + (w - 148) * travel;
  if (travel > 0 && travel < 1) {
    g.fillStyle = TEXT;
    g.beginPath();
    g.arc(dotX, y, 8, 0, Math.PI * 2);
    g.fill();
  }
  const prod = spring(local - 2.75, 220, 16);
  if (prod > 0) {
    g.save();
    g.translate(0, top + 290);
    g.scale(0.6 + 0.4 * prod, 0.6 + 0.4 * prod);
    g.globalAlpha *= clamp(prod * 1.5);
    roundRect(g, -150, -26, 300, 52, 26);
    g.fillStyle = ACCENT;
    g.fill();
    text(g, "production обновлён", 0, 1, 28, 700, TEXT, f.sans, "center");
    g.restore();
  }
}

const METRICS = [
  ["токены / день", 1_200_000, "M"],
  ["расход / день", 18, "$"],
  ["задержка", 1.4, "с"],
] as const;
function formatMetric(value: number, unit: string) {
  if (unit === "M") return `${(value / 1_000_000).toFixed(1)}M`;
  if (unit === "$") return `$${String(Math.round(value))}`;
  return `${value.toFixed(1)} с`;
}
/** Мониторинг: плитки прилетают снизу, числа досчитывают, полоски токенов растут. */
function drawMonitor({ g, f, local, w, h }: Frame) {
  const left = -w / 2 + 44;
  const top = -h / 2;
  text(g, "Мониторинг", left, top + 56, 34, 800, TEXT, f.sans);
  const tileW = (w - 88 - 32) / 3;
  for (const [i, [name, value, unit]] of METRICS.entries()) {
    const p = spring(local - 0.3 - i * 0.16, 200, 18);
    const x = left + i * (tileW + 16);
    const count = clamp((local - 0.6 - i * 0.16) / 1.1);
    flyIn(g, p, 0, 160, () => {
      roundRect(g, x, top + 100, tileW, 140, 18);
      g.fillStyle = INK_HIGH;
      g.fill();
      text(
        g,
        formatMetric(value * count, unit),
        x + 22,
        top + 156,
        44,
        800,
        i === 0 ? ACCENT_BRIGHT : TEXT,
        f.sans,
      );
      text(g, name, x + 22, top + 206, 26, 600, MUTED, f.sans);
    });
  }
  // Расход токенов по часам: столбики растут по очереди.
  const bars = 14;
  const barW = (w - 88) / bars - 8;
  for (let i = 0; i < bars; i++) {
    const value = 0.35 + 0.55 * Math.abs(Math.sin(i * 1.7 + 0.6));
    const p = spring(local - 0.9 - i * 0.05, 240, 20);
    const bh = 90 * value * p;
    g.fillStyle = i === bars - 3 ? ACCENT_BRIGHT : INK_HIGH;
    roundRect(g, left + i * (barW + 8), h / 2 - 40 - bh, barW, bh, 4);
    g.fill();
  }
}

const RELEASE_RISE = [0, 22, 14, 52, 46, 88, 104, 150] as const;
function drawReleases({ g, f, local, w, h }: Frame) {
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

function drawToast({ g, f, local }: Frame) {
  g.fillStyle = ACCENT;
  g.beginPath();
  g.arc(-250, 0, 26, 0, Math.PI * 2);
  g.fill();
  check(g, -250, 0, 24, clamp((local - 0.35) / 0.3), TEXT);
  text(g, "Релиз v1.4 выпущен", -206, 2, 36, 800, TEXT, f.sans);
}

const DRAW: Record<StateId, (frame: Frame) => void> = {
  pill: drawPill,
  prompt: drawPrompt,
  think: drawThink,
  harness: drawHarness,
  roles: drawRoles,
  spec: drawSpec,
  features: drawFeatures,
  diff: drawDiff,
  cicd: drawCicd,
  monitor: drawMonitor,
  releases: drawReleases,
  toast: drawToast,
};

/* ---------- Курсор по сцене ---------- */

/** Точки курсора в координатах холста: он подходит к элементу и нажимает. */
const CURSOR: readonly (readonly [number, number, number])[] = [
  [0, 760, 580],
  [0.7, 600, 350],
  [3.2, 830, 330],
  [4.5, 780, 560],
  [7.8, 700, 560],
  [8.4, 260, 238],
  [10.4, 820, 600],
];
const CLICKS = [1.0, 3.95, 8.75] as const;
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
    Math.min(clamp((t - 0.4) / 0.3), clamp((4.6 - t) / 0.3)) +
    Math.min(clamp((t - 7.7) / 0.3), clamp((9.6 - t) / 0.3));
  let press = 0;
  for (const at of CLICKS)
    if (t >= at && t < at + 0.45) press = (t - at) / 0.45;
  cursor(g, x, y, clamp(visible), press);
}

/* ---------- Кадр ---------- */

function drawEpisode(
  g: CanvasRenderingContext2D,
  t: number,
  fonts: FilmFonts,
  episode: Episode,
) {
  if (t < episode.start - 0.01 && episode.enter !== "none") return;
  if (episode.exit !== "none" && t > episode.end + SWING) return;
  if (episode.enter === "none" && t > episode.end + SWING) return;
  const place = placement(t, episode);
  const { w, h, r } = shape(t, episode.states);
  g.save();
  g.translate(CX + place.x, CY + place.y);
  g.rotate(place.rot);
  g.scale(place.scale, place.scale);
  g.shadowColor = "rgba(32, 33, 36, 0.22)";
  g.shadowBlur = 40;
  g.shadowOffsetY = 18;
  roundRect(g, -w / 2, -h / 2, w, h, r);
  g.fillStyle = INK;
  g.fill();
  g.shadowColor = "transparent";
  roundRect(g, -w / 2, -h / 2, w, h, r);
  g.clip();
  for (const [index, state] of episode.states.entries()) {
    const alpha = contentAlpha(t, episode, index);
    if (alpha <= 0 || t < state.at) continue;
    g.save();
    g.globalAlpha = alpha;
    DRAW[state.id]({ g, t, local: t - state.at, f: fonts, w, h });
    g.restore();
  }
  g.restore();
}

export function drawFilm(
  g: CanvasRenderingContext2D,
  time: number,
  fonts: FilmFonts,
) {
  const t = ((time % FILM_DURATION) + FILM_DURATION) % FILM_DURATION;
  g.fillStyle = CANVAS;
  g.fillRect(0, 0, FILM_WIDTH, FILM_HEIGHT);
  for (const episode of EPISODES) drawEpisode(g, t, fonts, episode);

  // Подпись под кружком «думает» стоит вне формы, на светлом фоне.
  const intro = EPISODES[0];
  if (intro) {
    const thinking =
      contentAlpha(t, intro, 2) * (1 - clamp((t - intro.end) / 0.3));
    if (thinking > 0 && t >= 4.4) {
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
  }
  drawCursor(g, t);
}

/** Текстовый эквивалент для скринридера: то же, что показывает анимация. */
export const FILM_DESCRIPTION =
  "Анимация курса: разработчик ставит агенту задачу, открывается harness проекта с файлами AGENTS.md, skills, roles, pipeline и evals и пайплайном от спецификации до деплоя, у агентов роли архитектора, разработчика и ревьюера, агенты пишут спецификацию, параллельно реализуют фичи и открывают pull request, CI/CD проводит сборку, тесты и деплой в production, мониторинг показывает токены, стоимость и задержку, растёт число релизов.";
