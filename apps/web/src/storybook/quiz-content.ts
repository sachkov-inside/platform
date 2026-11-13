/** Synthetic Content v2 input in the content-studio#86 `exercise-v1` shape. */
export const readerBlocks = [
  {
    kind: "markdown",
    markdown:
      "## Контекст задачи\n\nПеред тем как просить агента написать код, опишите результат: кто будет им пользоваться и что должно измениться.\n\nОдин запрос может дать рабочий код, но проверяемый результат требует ясной задачи.\n\n## Проверяемый результат\n\nКритерий описывает наблюдаемое поведение. Например: пользователь отправляет форму и видит созданную запись. Название технологии само по себе не доказывает, что задача решена.",
  },
  {
    kind: "quiz",
    id: "result-criterion",
    reveal: "none",
    contextMarkdown: "Агент добавил форму регистрации.",
    questionMarkdown: "Какой критерий лучше проверяет результат задачи?",
    selectionMode: "single",
    options: [
      {
        id: "stack",
        markdown: "Форма написана на React и TypeScript.",
        correct: false,
        explanationMarkdown:
          "Неверно. Это выбор инструментов. Он не показывает, может ли пользователь зарегистрироваться.",
      },
      {
        id: "account",
        markdown: "После отправки формы пользователь видит созданный аккаунт.",
        correct: true,
        explanationMarkdown:
          "Верно. Критерий называет действие пользователя и наблюдаемый результат. Его можно проверить.",
      },
      {
        id: "size",
        markdown: "Код формы занимает меньше ста строк.",
        correct: false,
        explanationMarkdown:
          "Неверно. Размер кода не доказывает работоспособность регистрации.",
      },
    ],
    dontKnow: {
      explanationMarkdown:
        "Ищите действие пользователя и результат, который можно увидеть. Технология и размер кода этого не заменяют.",
      reviewLinks: ["#проверяемый-результат"],
    },
  },
  {
    kind: "markdown",
    markdown:
      "## От критерия к проверке\n\nТеперь попросите агента показать, как он проверит выбранный критерий. Сначала договоритесь о результате, затем выбирайте инструменты.",
  },
  { kind: "step-break", label: "Как разделить работу?" },
  {
    kind: "match",
    id: "roles",
    reveal: "none",
    questionMarkdown: "Кто за что отвечает?",
    mode: "pairs",
    rows: [
      ["plan", "Пишет план изменений.", "planner", "План пишет планировщик."],
      ["code", "Меняет код.", "coder", "Код меняет исполнитель."],
      ["check", "Проверяет результат.", "reviewer", "Проверяет проверяющий."],
    ].map(
      ([id = "", markdown = "", answerId = "", explanationMarkdown = ""]) => ({
        id,
        markdown,
        answerId,
        explanationMarkdown,
      }),
    ),
    choices: [
      { id: "planner", markdown: "Планировщик" },
      { id: "coder", markdown: "Исполнитель" },
      { id: "reviewer", markdown: "Проверяющий" },
    ],
  },
  {
    kind: "order",
    id: "pipeline",
    reveal: "none",
    questionMarkdown: "В каком порядке идёт работа?",
    steps: [
      ["spec", "Описать результат.", "Без результата нечего проверять."],
      ["code", "Написать код.", "Код идёт после описания."],
      ["verify", "Проверить критерий.", "Проверка завершает работу."],
    ].map(([id = "", markdown = "", explanationMarkdown = ""]) => ({
      id,
      markdown,
      explanationMarkdown,
    })),
  },
  {
    kind: "markdown",
    markdown:
      "К чтению следующего раздела можно перейти при любом ответе или без ответа.",
  },
] as const;
