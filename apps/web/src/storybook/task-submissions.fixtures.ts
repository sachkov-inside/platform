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
  history: [],
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
      selfCheck: { outcome: "changes", attempt: 2, firstPassedAttempt: null },
      person: {
        accountId: "10000000-0000-4000-8000-000000000001",
        telegramIdentityRef: "telegram:synthetic-01",
        displayName: "Анна Смирнова",
        telegramUsername: "anna_example",
        telegramUrl: "https://t.me/anna_example",
        telegramContactState: "available",
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
      selfCheck: null,
      person: {
        accountId: "10000000-0000-4000-8000-000000000002",
        telegramIdentityRef: null,
        displayName: "Марк Белов",
        telegramUsername: null,
        telegramUrl: null,
        telegramContactState: "not_linked",
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
      selfCheck: { outcome: "missing", attempt: 1, firstPassedAttempt: null },
      person: {
        accountId: "10000000-0000-4000-8000-000000000001",
        telegramIdentityRef: "telegram:synthetic-01",
        displayName: "Анна Смирнова",
        telegramUsername: "anna_example",
        telegramUrl: "https://t.me/anna_example",
        telegramContactState: "available",
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
  nextProductCursor: null,
};

export const submissionsProductId = productId;
export const submissionsSecondChapter = secondChapter;

/** The default view of the same fixture: only submissions without Author Feedback (#1717). */
export const awaitingSubmissions: TaskSubmissions = {
  ...reviewedSubmissions,
  submissions: reviewedSubmissions.submissions.filter(
    (row) => row.authorFeedback === null,
  ),
};

const learners = [
  ["Анна Смирнова", "anna_example"],
  [null, "konstantin_vasilevsky_dev"],
  ["Марк Белов", null],
  ["Екатерина Александровна Иванова-Петрова", "katya_example"],
  ["Ольга Кравец", "olga_example"],
] as const;

/**
 * A long page: `count` deterministic submissions of the fixture tasks by five learners, every
 * third one commented, one hour apart and newest first. No randomness and no clock.
 */
export function manySubmissions(count: number): TaskSubmissions {
  const templates = reviewedSubmissions.submissions;
  return {
    ...reviewedSubmissions,
    submissions: Array.from({ length: count }, (_, index) => {
      const template = templates[index % templates.length];
      const learner = learners[index % learners.length];
      if (template === undefined || learner === undefined)
        throw new Error("fixture incomplete");
      const [displayName, username] = learner;
      return {
        ...template,
        submissionId: `31000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        submittedAt: new Date(
          Date.UTC(2026, 9, 24, 15, 40) - index * 3_600_000,
        ).toISOString(),
        person: {
          accountId: `11000000-0000-4000-8000-${String((index % learners.length) + 1).padStart(12, "0")}`,
          telegramIdentityRef:
            username === null ? null : `telegram:synthetic-${username}`,
          displayName,
          telegramUsername: username,
          telegramUrl: username === null ? null : `https://t.me/${username}`,
          telegramContactState: username === null ? "not_linked" : "available",
        },
        authorFeedback:
          index % 3 === 2
            ? {
                comment: "Хорошо: повтор проверен. Добавь владельца заявки.",
                reviewedAt: null,
                updatedAt: new Date(
                  Date.UTC(2026, 9, 24, 16, 0) - index * 3_600_000,
                ).toISOString(),
              }
            : null,
      };
    }),
    nextCursor: "page-2",
  };
}
