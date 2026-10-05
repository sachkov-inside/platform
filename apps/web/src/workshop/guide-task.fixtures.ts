import type {
  GuideTaskPlace,
  OpenGuideTask,
  OwnSubmissionsView,
} from "@/_pages/guide-task/model/guide-task-page";

/** Задание главы 1 из программы курса 05.10.2026; критерии — по `stage-1.yaml` Content. */
const criteriaV1 = [
  {
    id: "task-spec",
    level: "required",
    requirement:
      "Спецификация задания описывает вход, приглашение, проекты, доступ GitHub, подключение агента, запуск и диагностику. Задачи в Issues ссылаются на неё.",
    acceptableEvidence: [
      "Путь или ссылка на спецификацию, Issues со ссылками на неё, раздел рисков.",
    ],
  },
  {
    id: "project-access",
    level: "required",
    requirement:
      "Сотрудник видит и меняет только проекты, к которым ему дан доступ: в интерфейсе, API и MCP.",
    acceptableEvidence: [
      "Место проверки прав на сервере и сохранённые ответы двух учётных записей к одному проекту.",
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
    ],
  },
  {
    id: "second-agent",
    level: "additional",
    requirement:
      "Платформа поддерживает второго агента рядом с первым: инструкции подключения есть для обоих.",
    acceptableEvidence: ["Инструкции и результат подключения второго агента."],
  },
] as const;

const criteriaV2 = [
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
] as const;

const place = {
  code: "aie-ch1-onboarding",
  title: "Онбординг нового разработчика за час",
  guide: { slug: "ai-engineering", name: "AI Engineering" },
  chapter: { name: "Запусти MVP платформы вместе с агентами", ordinal: 1 },
};

export const openGuideTask: OpenGuideTask = {
  access: "open",
  task: {
    ...place,
    access: "membership",
    version: 2,
    definition: {
      situation:
        "Новый разработчик неделю выясняет, какие репозитории ему нужны, ждёт доступов и настраивает агента по чужим заметкам. CTO хочет, чтобы новичок выходил на работу за день.",
      result: [
        "Приглашённый сотрудник входит и связывает свой GitHub-аккаунт.",
        "Ответственный выдаёт доступ к репозиториям проекта, и GitHub это подтверждает.",
        "Агент сотрудника через MCP платформы получает инструкции только доступных проектов.",
        "Сотрудник без доступа получает отказ в интерфейсе, API и MCP.",
      ],
      freedom:
        "Стек, сервис входа, модель данных, интерфейс и способ выдачи доступа в GitHub выбираешь ты. Модули с описанными границами в одном приложении достаточно.",
      criteria: criteriaV2.map((criterion) => ({
        ...criterion,
        acceptableEvidence: [...criterion.acceptableEvidence],
      })),
    },
  },
  reviewProtocol: {
    version: "3",
    instructions: [
      "Respond in the participant’s language; when it is not established, use the language of the task.",
      "By default only read. Collect facts about the project by reading files and existing reports.",
      "Run something only with the participant's explicit consent to that exact command.",
    ],
  },
  relatedMaterials: [
    {
      slug: "mcp-client-server-tools",
      title: "MCP: клиент, сервер, tools и discovery",
      availability: "available",
    },
    {
      slug: "review-onboarding-1",
      title: "Разбор: три решения онбординга",
      availability: "locked",
    },
  ],
  submission: { accepting: true },
};

export const closedGuideTask: GuideTaskPlace = place;

const versions = [
  { version: 2, criteria: openGuideTask.task.definition.criteria },
  {
    version: 1,
    criteria: criteriaV1.map((criterion) => ({
      ...criterion,
      acceptableEvidence: [...criterion.acceptableEvidence],
    })),
  },
];

export const submittedTwice: OwnSubmissionsView = {
  kind: "ready",
  code: place.code,
  currentVersion: 2,
  versions,
  submissions: [
    {
      submissionId: "50000000-0000-4000-8000-000000000002",
      taskVersion: 2,
      source: "form",
      submittedAt: "2026-10-05T13:40:00.000Z",
      note: "Добавил отзыв доступа после увольнения: фоновая задача сверяет GitHub и MCP.\nНе уверен, что сверка выдержит 40 человек и 12 репозиториев.",
      reportText:
        "Проверял сам: отзыв срабатывает за 10 минут на тестовом аккаунте.",
      repositoryUrl: "https://github.com/learner/devportal",
      authorFeedback: null,
    },
    {
      submissionId: "50000000-0000-4000-8000-000000000001",
      taskVersion: 1,
      source: "mcp",
      submittedAt: "2026-10-03T08:15:00.000Z",
      note: "Сделал проекты, приглашения и выдачу доступа через GitHub App.\nНе уверен в выдаче доступа: при отказе GitHub пока показываю общую ошибку.",
      reportText: null,
      repositoryUrl: "https://github.com/learner/devportal",
      authorFeedback: {
        comment:
          "Границы модулей получились чистыми. Отказ GitHub стоит показывать отдельно от ожидания приглашения — это обязательный критерий.",
        reviewedAt: "2026-10-04T08:20:00.000Z",
      },
    },
  ],
};

export const notSubmittedYet: OwnSubmissionsView = {
  kind: "ready",
  code: place.code,
  currentVersion: 2,
  versions: [],
  submissions: [],
};

export const learnerMcpUrl = "https://inside.sachkov.dev/mcp/learning";
