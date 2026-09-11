/**
 * Throwaway fixture for the Guide showcase prototype. The wording is the real
 * Inside Content text of «Инфраструктура, релизы и продакшен», rewritten into
 * the blocks the reference funnel uses. Nothing here is a production contract.
 */
export interface ShowcaseSegment {
  readonly detail: string;
  readonly title: string;
}

export interface ShowcaseChapter {
  readonly materials: number;
  readonly summary: string;
  readonly title: string;
  readonly tone: "amber" | "blue" | "green" | "purple" | "rose";
}

export interface ShowcaseArtifact {
  readonly detail: string;
  readonly title: string;
}

export interface ShowcaseGuide {
  readonly artifacts: readonly ShowcaseArtifact[];
  readonly chapters: readonly ShowcaseChapter[];
  readonly materials: number;
  readonly meta: string;
  readonly name: string;
  readonly outOfScope: string;
  readonly pitch: string;
  readonly proof: {
    readonly caption: string;
    readonly detail: string;
    readonly value: string;
  };
  readonly requirements: readonly ShowcaseSegment[];
  readonly results: readonly string[];
  readonly segments: readonly ShowcaseSegment[];
  readonly support: {
    readonly detail: string;
    readonly items: readonly string[];
    readonly title: string;
  };
  readonly topic: string;
  readonly workflow: string;
}

export const infrastructureGuide: ShowcaseGuide = {
  name: "Инфраструктура, релизы и продакшен",
  topic: "Руководство",
  pitch:
    "Подготовим инфраструктуру твоего приложения: окружения, сервер, секреты, базу данных и внешние сервисы. Настроим проверки, релизы, деплой, резервное копирование и восстановление.",
  meta: "30 материалов · 7 глав · артефакты",
  materials: 30,
  segments: [
    {
      title: "Тем, кто пишет свой сервис",
      detail:
        "Чтобы выпускать обновления по понятному пути: от проверок в CI до подтверждённого обновления на сервере, без ручных шагов по памяти.",
    },
    {
      title: "Тем, у кого приложение уже работает",
      detail:
        "Чтобы навести порядок в окружениях, секретах и резервных копиях и знать, что делать, когда релиз пошёл не так.",
    },
    {
      title: "Тем, кто выбирает инфраструктуру",
      detail:
        "Чтобы сравнить способы размещения по задачам проекта, полной стоимости и объёму обслуживания, а не по советам из интернета.",
    },
  ],
  results: [
    "Опубликованный релиз с известным составом",
    "Тестовый сервер с HTTPS и доменом",
    "Обновление A → B с сохранением данных",
    "Проверенное восстановление базы из копии",
  ],
  proof: {
    value: "30 материалов",
    caption: "26 гайдов, 2 заметки и 2 видео",
    detail:
      "Сквозной пример — заметки: один проект, который проходит весь путь от первой проверки до обновления на сервере.",
  },
  chapters: [
    {
      title: "Проект и CI",
      summary:
        "Разберём, чем CI, релиз и деплой отличаются, и настроим проверки своего проекта до слияния в main.",
      materials: 6,
      tone: "blue",
    },
    {
      title: "Образы приложения",
      summary:
        "Упакуем приложение так, чтобы его можно было запускать без исходников и инструментов с твоего компьютера.",
      materials: 3,
      tone: "purple",
    },
    {
      title: "Публикация и проверка релиза",
      summary:
        "Свяжем версию с commit и образами и проверим опубликованный релиз локально, ещё не выбирая сервер.",
      materials: 3,
      tone: "green",
    },
    {
      title: "Окружение и инфраструктура",
      summary:
        "Сравним способы размещения по задачам, стоимости и обслуживанию и подготовим выбранную среду.",
      materials: 6,
      tone: "amber",
    },
    {
      title: "Первый деплой и защита данных",
      summary:
        "Запустим версию A, настроим домен и HTTPS и проверим восстановление базы из резервной копии.",
      materials: 4,
      tone: "rose",
    },
    {
      title: "Обновление приложения",
      summary:
        "Выпустим версию B, обновим A → B с сохранением данных и разберём, когда возврат к A ещё допустим.",
      materials: 3,
      tone: "blue",
    },
    {
      title: "Файлы, почта и видео",
      summary:
        "По потребности проекта подключим объектное хранилище, почту с подтверждённым доменом или видеохостинг.",
      materials: 5,
      tone: "purple",
    },
  ],
  workflow:
    "Каждый материал — шаг на твоём проекте. Ты делаешь его у себя, а разобранный пример показывает, как это выглядит целиком. Если проекта пока нет, в первой главе собираем небольшую заготовку.",
  requirements: [
    {
      title: "Базовый Git и терминал",
      detail:
        "Умение открыть папку проекта и выполнить команду. Docker и серверные понятия объясняются по ходу.",
    },
    {
      title: "Свой проект или пустая папка",
      detail:
        "Проект должен запускаться. Для учебной заготовки достаточно пустой папки и агента с доступом к файлам.",
    },
    {
      title: "Доступы готовятся по ходу",
      detail:
        "Провайдер выбирается в главе про окружение. Платные действия — только после того, как ты выбрал условия.",
    },
  ],
  artifacts: [
    {
      title: "Чек-лист готовности к первому деплою",
      detail: "Что проверить перед тем, как впервые запустить версию на сервере.",
    },
    {
      title: "Матрица выбора инфраструктуры",
      detail: "Сравнение способов размещения по задачам, стоимости и обслуживанию.",
    },
    {
      title: "Пример продакшен-Compose",
      detail: "Рабочая конфигурация, от которой можно оттолкнуться в своём проекте.",
    },
  ],
  outOfScope:
    "Создание нового Kubernetes-кластера, высокая доступность и переключение продакшена на восстановленную базу. Наблюдение за работой приложения и регулярное обслуживание пока в плане — я скажу об этом честно на странице программы.",
  support: {
    title: "Сопровождение",
    detail:
      "Входит в тариф «Материалы + сопровождение»: общий чат, вопросы автору и разборы на эфирах.",
    items: [
      "Вопросы по шагам руководства",
      "Разбор твоего проекта на эфире",
      "Общий чат участников",
    ],
  },
};
