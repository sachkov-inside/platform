import type { TaskSubmissions } from "@/_pages/task-submissions/model/task-submissions";

const productId = "00000000-0000-4000-8000-000000000948";
const firstChapter = "00000000-0000-4000-8000-000000000949";
const secondChapter = "00000000-0000-4000-8000-000000000950";

const criteria = [
  {
    id: "access",
    level: "required" as const,
    requirement: "Новичок получает доступ к репозиториям через платформу.",
    acceptableEvidence: ["Ответ GitHub после выдачи доступа."],
  },
  {
    id: "owner",
    level: "required" as const,
    requirement: "Доступ выдаёт только руководитель команды.",
    acceptableEvidence: ["Проверка роли до вызова GitHub."],
  },
  {
    id: "second-agent",
    level: "additional" as const,
    requirement: "Второй агент проверяет выдачу.",
    acceptableEvidence: ["Инструкция второго агента."],
  },
];

/** Two submissions of chapter 1 and one of chapter 2: an agent's report, a form, feedback. */
export const reviewedSubmissions: TaskSubmissions = {
  products: [
    {
      id: productId,
      name: "AI Engineering",
      chapters: [
        {
          id: firstChapter,
          name: "Глава 1. Онбординг",
          tasks: [{ code: "aie-ch1-onboarding", title: "Онбординг команды" }],
        },
        {
          id: secondChapter,
          name: "Глава 2. Заявки",
          tasks: [{ code: "aie-ch2-requests", title: "Заявки клиентов" }],
        },
      ],
    },
  ],
  submissions: [
    {
      submissionId: "30000000-0000-4000-8000-000000000003",
      submittedAt: "2026-10-05T16:40:00.000Z",
      source: "mcp",
      task: {
        code: "aie-ch1-onboarding",
        title: "Онбординг команды",
        productId,
        productName: "AI Engineering",
        chapterId: firstChapter,
        chapterName: "Глава 1. Онбординг",
        currentVersion: 2,
      },
      taskVersion: 2,
      person: {
        accountId: "10000000-0000-4000-8000-000000000001",
        telegramIdentityRef: "telegram:synthetic-01",
      },
      note: "Сделал выдачу доступа через бота.\nРоль проверяю до вызова GitHub.\nНе уверен, что второй агент нужен на каждой выдаче.",
      reviewReport: {
        criteria: [
          {
            criterionId: "access",
            status: "confirmed",
            evidence:
              "README.md описывает выдачу; лог `grant.log` показывает ответ GitHub 201.",
            gap: "",
            obtainedByRun: false,
          },
          {
            criterionId: "owner",
            status: "violation",
            evidence:
              '<img src=x onerror="alert(1)"> Роль читается из запроса.',
            gap: "Роль приходит от клиента, сервер её не проверяет.",
            obtainedByRun: true,
          },
          {
            criterionId: "second-agent",
            status: "not_verified",
            evidence: "",
            gap: "Инструкции второго агента в репозитории нет.",
            obtainedByRun: false,
          },
        ],
      },
      reportText: null,
      serviceMark: {
        repositoryUrl: "https://github.com/learner/devportal",
        branch: "main",
        commit: "4f2a9c1",
        uncommittedChanges: true,
      },
      authorFeedback: null,
    },
    {
      submissionId: "30000000-0000-4000-8000-000000000002",
      submittedAt: "2026-10-04T09:15:00.000Z",
      source: "form",
      task: {
        code: "aie-ch2-requests",
        title: "Заявки клиентов",
        productId,
        productName: "AI Engineering",
        chapterId: secondChapter,
        chapterName: "Глава 2. Заявки",
        currentVersion: 1,
      },
      taskVersion: 1,
      person: {
        accountId: "10000000-0000-4000-8000-000000000002",
        telegramIdentityRef: null,
      },
      note: "Агента с MCP нет, сдаю через форму.",
      reviewReport: null,
      reportText: "Проверил сам: заявка создаётся, повтор не создаёт вторую.",
      serviceMark: {
        repositoryUrl: "https://github.com/learner/requests",
        branch: null,
        commit: null,
        uncommittedChanges: null,
      },
      authorFeedback: {
        comment: "Хорошо: повтор проверен. Добавь владельца заявки.",
        reviewedAt: "2026-10-04T12:00:00.000Z",
        updatedAt: "2026-10-04T12:05:00.000Z",
      },
    },
    {
      submissionId: "30000000-0000-4000-8000-000000000001",
      submittedAt: "2026-10-03T18:20:00.000Z",
      source: "mcp",
      task: {
        code: "aie-ch1-onboarding",
        title: "Онбординг команды",
        productId,
        productName: "AI Engineering",
        chapterId: firstChapter,
        chapterName: "Глава 1. Онбординг",
        currentVersion: 2,
      },
      taskVersion: 1,
      person: {
        accountId: "10000000-0000-4000-8000-000000000001",
        telegramIdentityRef: "telegram:synthetic-01",
      },
      note: "",
      reviewReport: {
        criteria: [
          {
            criterionId: "access",
            status: "confirmed",
            evidence: "README.md описывает выдачу.",
            gap: "",
            obtainedByRun: false,
          },
          {
            criterionId: "owner",
            status: "not_verified",
            evidence: "",
            gap: "Проверки роли нет.",
            obtainedByRun: false,
          },
        ],
      },
      reportText: null,
      serviceMark: {
        repositoryUrl: null,
        branch: null,
        commit: null,
        uncommittedChanges: null,
      },
      authorFeedback: null,
    },
  ],
  versions: [
    { code: "aie-ch1-onboarding", version: 2, criteria },
    {
      code: "aie-ch1-onboarding",
      version: 1,
      criteria: criteria.slice(0, 2),
    },
    {
      code: "aie-ch2-requests",
      version: 1,
      criteria: [
        {
          id: "request",
          level: "required",
          requirement: "Участник создаёт заявку и видит её статус.",
          acceptableEvidence: ["Сценарий создания."],
        },
      ],
    },
  ],
  nextCursor: null,
};

export const submissionsProductId = productId;
export const submissionsSecondChapter = secondChapter;
