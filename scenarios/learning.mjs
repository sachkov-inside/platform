// @ts-check
const taskDefinition = {
  schemaVersion: 1,
  situation:
    "Команда учебного проекта хочет проверить, что первый результат можно повторить.",
  result: [
    "Участник показывает первый результат.",
    "Другой участник повторяет проверку.",
  ],
  freedom: "Участник сам выбирает инструменты и способ показать результат.",
  criteria: [
    {
      id: "result",
      level: "required",
      requirement: "Первый результат виден и проверен.",
      acceptableEvidence: ["Наблюдаемый результат проверки."],
    },
    {
      id: "repeat",
      level: "required",
      requirement: "Проверку может повторить другой участник.",
      acceptableEvidence: ["Пошаговая инструкция проверки."],
    },
  ],
};

/** Synthetic learning state shared by fixtures and isolated-application setup. */
export const learningScenario = {
  fixtureDate: "2026-11-16T10:00:00.000Z",
  format: { id: "guide", slug: "guide", name: "Гайд" },
  product: {
    id: "97000000-0000-4000-8000-000000000001",
    name: "Учебный курс: от идеи к выпуску",
    slug: "synthetic-learning",
    summary:
      "Вымышленный проект для проверки обучения, практики и обратной связи.",
  },
  topic: {
    id: "97000000-0000-4000-8000-000000000002",
    name: "Учебные примеры",
    slug: "synthetic-learning",
    summary: "Синтетические сценарии обучения.",
  },
  reading: {
    openingHeading: "Первый шаг",
    checkHeading: "Проверка результата",
    checkInstruction: "Покажи результат учебного шага и повтори проверку.",
  },
  lessons: [
    {
      key: "intro",
      slug: "synthetic-intro",
      id: "97000000-0000-4000-8000-000000000011",
      title: "Учебный пример: первый шаг",
      access: "free",
      summary: "Определяем первый результат учебного проекта.",
    },
    {
      key: "project",
      slug: "synthetic-project",
      id: "97000000-0000-4000-8000-000000000012",
      title: "Учебный пример: работа над проектом",
      access: "closed",
      summary: "Продолжаем учебный проект после первого результата.",
    },
    {
      key: "release",
      slug: "synthetic-release",
      id: "97000000-0000-4000-8000-000000000013",
      title: "Учебный пример: проверка выпуска",
      access: "closed",
      summary: "Проверяем готовность учебного проекта к выпуску.",
    },
    {
      key: "reference",
      slug: "synthetic-reference",
      id: "97000000-0000-4000-8000-000000000014",
      title: "Учебный пример: памятка",
      access: "free",
      summary: "Дополнительная памятка для главы учебного проекта.",
    },
  ],
  chapters: [
    {
      key: "start",
      id: "97000000-0000-4000-8000-000000000101",
      name: "Начало учебного проекта",
      lessons: ["intro", "project"],
      supplementary: ["reference"],
    },
    {
      key: "release",
      slug: "synthetic-release",
      id: "97000000-0000-4000-8000-000000000102",
      name: "Выпуск учебного проекта",
      lessons: ["release"],
      supplementary: [],
    },
    {
      key: "soon",
      id: "97000000-0000-4000-8000-000000000103",
      name: "Следующая учебная глава",
      lessons: [],
      supplementary: [],
    },
  ],
  artifact: {
    id: "97000000-0000-4000-8000-000000000201",
    sourceId: "synthetic-scenarios:result",
    reference: "result",
    material: "reference",
    downloadLabel: "Скачать шаблон результата (.txt)",
    title: "Учебный пример: шаблон результата",
    purpose: "Образец результата учебного проекта.",
    access: "free",
    filename: "synthetic-result.txt",
    contentType: "text/plain",
    text: "Учебный результат: первый шаг и повторяемая проверка.\n",
  },
  learning: {
    role: "holder",
    completed: ["intro"],
    started: "project",
    openedParts: 1,
    bookmark: "project",
  },
  glossary: {
    id: "synthetic-result",
    title: "Учебный результат",
    englishTitle: "Learning outcome",
    shortDefinition: "Наблюдаемый результат одного шага учебного проекта.",
    fullDefinition:
      "Результат учебного шага, который участник может показать и проверить.",
    introducedIn: "intro",
  },
  task: {
    code: "synthetic-project",
    title: "Учебный пример: покажи результат",
    access: "closed",
    currentVersion: 2,
    chapter: "start",
    after: "project",
    definition: taskDefinition,
    outdatedDefinition: {
      ...taskDefinition,
      criteria: taskDefinition.criteria.slice(0, 1),
    },
    relatedMaterials: ["reference"],
    outdatedSubmissionNote: "Первая учебная попытка до изменения задания.",
    submission: {
      note: "Учебный результат проверен по инструкции.",
    },
    feedback: {
      comment: "Учебный результат понятен. Добавь пример входных данных.",
      reviewed: true,
    },
  },
};
