/**
 * PROTOTYPE #947 — throwaway, lives only on branch `prototype/947-task-page`.
 * Data for the task page and programme variants. Texts follow `inside-content`
 * `practice/ai-engineering/stage-1.yaml` and the curriculum of 05.10.2026.
 */
import type { MaterialPreview } from "@/entities/material";

export type CriterionLevel = "required" | "additional";

export interface PrototypeCriterion {
  readonly id: string;
  readonly level: CriterionLevel;
  readonly requirement: string;
  readonly acceptableEvidence: readonly string[];
}

export interface PrototypeSubmission {
  readonly id: string;
  readonly submittedAt: string;
  readonly source: "mcp" | "form";
  readonly version: number;
  readonly note: string;
  readonly repository?: string;
  readonly branch?: string;
  readonly commit?: string;
  readonly feedback?: {
    readonly comment?: string;
    readonly seenAt?: string;
  };
}

export interface PrototypeRelated {
  readonly slug: string;
  readonly title: string;
  /** Free material label (Tag): «Теория», «Как работать», «Разбор». */
  readonly label: string;
  readonly duration?: string;
}

export interface PrototypeTask {
  readonly code: string;
  readonly title: string;
  readonly guide: { readonly name: string; readonly slug: string };
  readonly chapter: { readonly number: number; readonly name: string };
  readonly access: "free" | "membership";
  readonly version: number;
  readonly versionUpdatedAt: string;
  readonly situation: string;
  readonly result: readonly string[];
  readonly freedom: string;
  readonly criteria: readonly PrototypeCriterion[];
  /** Criteria of older versions that the learner's submissions reference. */
  readonly versionCriteria: Readonly<Record<number, readonly PrototypeCriterion[]>>;
  readonly related: readonly PrototypeRelated[];
}

export const learnerMcpUrl = "https://inside.sachkov.dev/mcp/learning";

const criteriaV1: readonly PrototypeCriterion[] = [
  {
    id: "task-spec",
    level: "required",
    requirement:
      "Спецификация задания описывает вход, приглашение, проекты, доступ GitHub, подключение агента, запуск и диагностику. Задачи в Issues ссылаются на неё, принятые риски записаны.",
    acceptableEvidence: [
      "Путь или ссылка на спецификацию, Issues со ссылками на неё, раздел рисков.",
    ],
  },
  {
    id: "projects",
    level: "required",
    requirement:
      "Ответственный создаёт проект, подключает к нему репозитории и участников; данные сохраняются после перезапуска.",
    acceptableEvidence: [
      "Код и сохранённая запись запуска: проект с репозиторием до перезапуска и в новом ответе сервера после него.",
    ],
  },
  {
    id: "identity-invitation",
    level: "required",
    requirement:
      "Вступает только приглашённый человек. Сервер определяет пользователя по подтверждённому входу, а не по идентификатору из запроса.",
    acceptableEvidence: [
      "Код получения пользователя на сервере и сохранённые результаты запусков для приглашённой и неприглашённой учётных записей.",
    ],
  },
  {
    id: "project-access",
    level: "required",
    requirement:
      "Сотрудник видит и меняет только проекты, к которым ему дан доступ. Правило действует для интерфейса, прямого запроса к API и MCP.",
    acceptableEvidence: [
      "Место проверки прав на сервере и сохранённые результаты прямых запросов двух учётных записей к одному проекту.",
      "Скрытая кнопка или фильтр на клиенте критерий не подтверждают.",
    ],
  },
  {
    id: "github-access-grant",
    level: "required",
    requirement:
      "Ответственный через платформу выдаёт связанному GitHub-аккаунту доступ к репозиториям проекта. Интерфейс отличает подтверждённый доступ, ожидание приглашения и отказ GitHub.",
    acceptableEvidence: [
      "Сохранённый ответ реального GitHub о доступе после выдачи.",
      "Тест с mock подтверждает обработку ответа, но не реальную выдачу.",
    ],
  },
  {
    id: "agent-mcp",
    level: "required",
    requirement:
      "Агент сотрудника подключается к MCP платформы от его имени и получает инструкции и контекст только доступных ему проектов.",
    acceptableEvidence: [
      "Конфигурация подключения без секретов и сохранённые результаты реальных вызовов MCP для сотрудника с доступом и без него.",
    ],
  },
  {
    id: "idempotent-grant",
    level: "additional",
    requirement:
      "Повторная выдача прав ничего не ломает, а сверка с GitHub находит расхождения.",
    acceptableEvidence: ["Тест повторной выдачи и результат сверки."],
  },
  {
    id: "second-agent",
    level: "additional",
    requirement:
      "Платформа поддерживает второго агента рядом с первым: инструкции подключения есть для обоих.",
    acceptableEvidence: ["Инструкции и результат подключения второго агента."],
  },
];

const criteriaV2: readonly PrototypeCriterion[] = [
  ...criteriaV1.filter(({ level }) => level === "required"),
  {
    id: "access-revoke",
    level: "required",
    requirement:
      "После увольнения сотрудника доступ отзывается везде в течение часа: в платформе, в GitHub и в MCP.",
    acceptableEvidence: [
      "Сохранённые ответы платформы, GitHub и MCP до отзыва и через час после него.",
    ],
  },
  ...criteriaV1.filter(({ level }) => level === "additional"),
  {
    id: "diagnostics-explained",
    level: "additional",
    requirement:
      "Диагностика объясняет недостающий доступ простыми словами с помощью модели и не выдумывает причин.",
    acceptableEvidence: ["Сохранённые ответы диагностики на два разных сбоя."],
  },
];

export const task: PrototypeTask = {
  code: "aie-ch1-onboarding",
  title: "Онбординг нового разработчика за час",
  guide: { name: "AI Engineering", slug: "ai-engineering" },
  chapter: { number: 1, name: "Запусти MVP платформы вместе с агентами" },
  access: "membership",
  version: 2,
  versionUpdatedAt: "2026-10-04T09:00:00.000Z",
  situation:
    "Новый разработчик неделю выясняет, какие репозитории ему нужны, ждёт доступов и настраивает агента по чужим заметкам. CTO хочет, чтобы новичок выходил на работу за день. Ответственный создаёт проект и подключает репозитории, а новичок входит, получает доступ и поднимает проект со своим агентом.",
  result: [
    "Приглашённый сотрудник входит и связывает свой GitHub-аккаунт.",
    "Ответственный выдаёт доступ к репозиториям проекта, и GitHub это подтверждает.",
    "Агент сотрудника через MCP платформы получает инструкции только доступных проектов.",
    "Сотрудник с агентом поднимает проект по этим инструкциям.",
    "Диагностика называет недостающий доступ или настройку.",
    "Сотрудник без доступа получает отказ в интерфейсе, API и MCP.",
  ],
  freedom:
    "Стек, сервис входа, модель данных, интерфейс, устройство MCP-сервера и способ выдачи доступа в GitHub выбираешь ты. Модули с описанными границами в одном приложении достаточно; отдельные сервисы — по желанию. Вторая тестовая учётная запись вместо второго человека подходит.",
  criteria: criteriaV2,
  versionCriteria: { 1: criteriaV1, 2: criteriaV2 },
  related: [
    {
      slug: "mcp-client-server-tools",
      title: "MCP: клиент, сервер, tools и discovery",
      label: "Теория",
      duration: "18 мин",
    },
    {
      slug: "split-large-task",
      title: "Как разбить крупное задание на задачи для агента",
      label: "Как работать",
      duration: "12 мин",
    },
    {
      slug: "review-onboarding-1",
      title: "Разбор: три решения онбординга, эфир 9 октября",
      label: "Разбор",
      duration: "54 мин",
    },
  ],
};

export const submissions: readonly PrototypeSubmission[] = [
  {
    id: "s2",
    submittedAt: "2026-10-05T16:40:00.000Z",
    source: "form",
    version: 2,
    repository: "https://github.com/ivan-dev/devportal",
    note: "Добавил отзыв доступа после увольнения: фоновая задача раз в 10 минут сверяет GitHub и MCP.\nДиагностику с моделью не делал.\nНе уверен, что сверка выдержит 40 человек и 12 репозиториев: лимиты GitHub API не проверял.",
  },
  {
    id: "s1",
    submittedAt: "2026-10-03T11:15:00.000Z",
    source: "mcp",
    version: 1,
    repository: "https://github.com/ivan-dev/devportal",
    branch: "main",
    commit: "4f2a9c1",
    note: "Сделал проекты, приглашения, выдачу доступа через GitHub App и MCP только на чтение.\nМодули core, github и mcp разделены, границы описаны в docs/architecture.md.\nНе уверен в выдаче доступа: при отказе GitHub пока показываю общую ошибку.",
    feedback: {
      comment:
        "Границы модулей получились чистыми, выдачу через GitHub App разберу в эфире 9 октября. Отказ GitHub стоит показывать отдельно от ожидания приглашения — это обязательный критерий.",
      seenAt: "2026-10-04T08:20:00.000Z",
    },
  },
];

/* ───────────── Programme of chapter 1 ───────────── */

export type ProgrammeEntry =
  | { readonly kind: "material"; readonly material: MaterialPreview }
  | {
      readonly kind: "task";
      readonly code: string;
      readonly title: string;
      readonly access: "free" | "membership";
      readonly locked: boolean;
      readonly submittedAt?: string;
    };

function material(
  index: number,
  title: string,
  format: "video" | "guide",
  label: string,
): MaterialPreview {
  return {
    materialId: `prototype-947-material-${String(index)}`,
    slug: `prototype-947-material-${String(index)}`,
    title,
    access: "membership",
    availability: "available",
    format: format === "video" ? "Видео" : "Гайд",
    formatSlug: format,
    ...(format === "video" ? { primaryVideoDurationSeconds: 1500 } : {}),
    summary: "",
    topic: label,
    topicSlug: "ai-engineering",
    tags: [label],
    seriesMemberships: [
      { name: "AI Engineering", slug: "ai-engineering", ordinal: index },
    ],
  };
}

const onboardingTask = {
  kind: "task",
  code: "aie-ch1-onboarding",
  title: "Онбординг нового разработчика за час",
  access: "membership",
  locked: false,
  submittedAt: "2026-10-05T16:40:00.000Z",
} as const;
const accessTask = {
  kind: "task",
  code: "aie-ch1-diagnostics",
  title: "Диагностика подключения и отказ без доступа",
  access: "membership",
  locked: false,
} as const;

/** Chapter 1 in the order the author would set under the decision of 05.10.2026. */
export const authorOrder: readonly ProgrammeEntry[] = [
  { kind: "material", material: material(1, "Глава 1: что строим и зачем", "video", "Видео") },
  { kind: "material", material: material(2, "Требования и спецификация с агентом", "guide", "Теория") },
  onboardingTask,
  { kind: "material", material: material(3, "MCP: клиент, сервер, tools и discovery", "guide", "Теория") },
  { kind: "material", material: material(4, "Как разбить крупное задание на задачи", "guide", "Как работать") },
  accessTask,
  { kind: "material", material: material(5, "Разбор: три решения онбординга", "video", "Разбор") },
];

/** Same chapter with tasks as one group after the chapter video (spec #939 default). */
export const groupedOrder = {
  before: authorOrder.filter(
    (entry, index) => entry.kind === "material" && index === 0,
  ),
  tasks: [onboardingTask, accessTask] as const,
  after: authorOrder.filter(
    (entry, index) => entry.kind === "material" && index > 0,
  ),
};

/** Chapter 2 seen by a reader without access: tasks are locked like materials. */
export const lockedChapter: readonly ProgrammeEntry[] = [
  {
    kind: "material",
    material: {
      ...material(6, "Глава 2: общий harness команды", "video", "Видео"),
      availability: "locked",
    },
  },
  {
    kind: "task",
    code: "aie-ch2-tool-catalog",
    title: "Каталог tools с правами по ролям",
    access: "membership",
    locked: true,
  },
];

export function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function formatDayTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function agentPhrase(code: string): string {
  return `Проверь моё задание ${code} через учебный MCP Sachkov Inside и помоги его сдать.`;
}
