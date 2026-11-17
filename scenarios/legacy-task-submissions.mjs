// @ts-check
const requestsFeedback = {
  comment: "Хорошо: повтор проверен. Добавь владельца заявки.",
  reviewedAt: "2026-10-04T12:00:00.000Z",
  updatedAt: "2026-10-04T12:05:00.000Z",
};

/** Existing author-review snapshots; navigation keeps its separate fourth submission. */
export const legacyTaskSubmissionFacts = {
  product: {
    id: "00000000-0000-4000-8000-000000000948",
    name: "AI Engineering",
  },
  chapters: {
    onboarding: {
      id: "00000000-0000-4000-8000-000000000949",
      name: "Глава 1. Онбординг",
    },
    requests: {
      id: "00000000-0000-4000-8000-000000000950",
      name: "Глава 2. Заявки",
    },
  },
  tasks: {
    onboarding: {
      code: "aie-ch1-onboarding",
      title: "Онбординг команды",
      chapter: "onboarding",
      currentVersion: 2,
    },
    requests: {
      code: "aie-ch2-requests",
      title: "Заявки клиентов",
      chapter: "requests",
      currentVersion: 1,
    },
  },
  people: {
    anna: {
      accountId: "10000000-0000-4000-8000-000000000001",
      telegramIdentityRef: "telegram:synthetic-01",
      displayName: "Анна Смирнова",
      telegramUsername: "anna_example",
      telegramUrl: "https://t.me/anna_example",
      telegramContactState: "available",
    },
    mark: {
      accountId: "10000000-0000-4000-8000-000000000002",
      telegramIdentityRef: null,
      displayName: "Марк Белов",
      telegramUsername: null,
      telegramUrl: null,
      telegramContactState: "not_linked",
    },
    olga: {
      accountId: "10000000-0000-4000-8000-000000000003",
      telegramIdentityRef: "telegram:synthetic-03",
      displayName: null,
      telegramUsername: "olga_example",
      telegramUrl: "https://t.me/olga_example",
      telegramContactState: "available",
    },
  },
  versions: [
    {
      task: "onboarding",
      version: 2,
      criteria: [
        {
          id: "access",
          level: "required",
          requirement:
            "Новичок получает доступ к репозиториям через платформу.",
          acceptableEvidence: ["Ответ GitHub после выдачи доступа."],
        },
        {
          id: "owner",
          level: "required",
          requirement: "Доступ выдаёт только руководитель команды.",
          acceptableEvidence: ["Проверка роли до вызова GitHub."],
        },
        {
          id: "second-agent",
          level: "additional",
          requirement: "Второй агент проверяет выдачу.",
          acceptableEvidence: ["Инструкция второго агента."],
        },
      ],
    },
    {
      task: "onboarding",
      version: 1,
      criteria: [
        {
          id: "access",
          level: "required",
          requirement:
            "Новичок получает доступ к репозиториям через платформу.",
          acceptableEvidence: ["Ответ GitHub после выдачи доступа."],
        },
        {
          id: "owner",
          level: "required",
          requirement: "Доступ выдаёт только руководитель команды.",
          acceptableEvidence: ["Проверка роли до вызова GitHub."],
        },
      ],
    },
    {
      task: "requests",
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
  requestsFeedback: requestsFeedback,
  reviewed: [
    {
      id: "30000000-0000-4000-8000-000000000003",
      task: "onboarding",
      person: "anna",
      submittedAt: "2026-10-05T16:40:00.000Z",
      source: "mcp",
      taskVersion: 2,
      selfCheck: {
        outcome: "changes",
        attempt: 2,
        firstPassedAttempt: null,
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
      id: "30000000-0000-4000-8000-000000000002",
      task: "requests",
      person: "mark",
      submittedAt: "2026-10-04T09:15:00.000Z",
      source: "form",
      taskVersion: 1,
      selfCheck: null,
      note: "Агента с MCP нет, сдаю через форму.",
      reviewReport: null,
      reportText: "Проверил сам: заявка создаётся, повтор не создаёт вторую.",
      serviceMark: {
        repositoryUrl: "https://github.com/learner/requests",
        branch: null,
        commit: null,
        uncommittedChanges: null,
      },
      authorFeedback: requestsFeedback,
    },
    {
      id: "30000000-0000-4000-8000-000000000001",
      task: "onboarding",
      person: "anna",
      submittedAt: "2026-10-03T18:20:00.000Z",
      source: "mcp",
      taskVersion: 1,
      selfCheck: {
        outcome: "missing",
        attempt: 1,
        firstPassedAttempt: null,
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
  navigationAdditional: {
    id: "30000000-0000-4000-8000-000000000004",
    task: "requests",
    person: "olga",
    submittedAt: "2026-10-02T07:30:00.000Z",
    source: "form",
    taskVersion: 1,
    note: "Сдаю через форму, агента подключу позже.",
    reviewReport: null,
    reportText: "Заявка создаётся, статус виден в списке.",
    serviceMark: {
      repositoryUrl: null,
      branch: null,
      commit: null,
      uncommittedChanges: null,
    },
    authorFeedback: null,
    selfCheck: null,
  },
};
