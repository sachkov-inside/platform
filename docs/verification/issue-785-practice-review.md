# Проверка практики своим агентом: свидетельства #785

Задача: [Platform #785](https://github.com/sachkov-inside/platform/issues/785),
источник: [AI Engineering #105](https://github.com/sachkov-inside/ai-engineering/issues/105).
Реализация проверена от `29c50ba67b1b083b7cb43dd4158ea0d4c851f62a` до
`607709e2ea03a805c9e53a7490a1f71275103d9c`. Последующие изменения этого отчёта сохраняют результаты,
а не меняют проверенный код. Дата: 27 сентября 2026 года.

## Что проверено

Участник копирует запрос у доступного задания, открывает отдельную сессию своего агента и получает
полный контекст через ученический MCP. Агент находит выбранную работу локально, разбирает все
критерии, предлагает необязательное обсуждение и перечитывает результат после внешнего исправления.
Сервер не оценивает работу моделью и не получает файлы проекта. Оригиналы курса принадлежат Content;
здесь используются три полных синтетических материала и задания: бриф, спецификация, HTTP-фича.

| Проверка | Результат и границы |
| --- | --- |
| `pnpm check:static` | Пройдена после интеграции native harness: документация, формат, генерация, API, lint, типы и архитектурные ограничения. После уточнения sandbox-version повторены его типы/lint и реальный probe. |
| `pnpm check:unit` | Пройдена: 223 tooling, 60 authoring, 1 fixture, 728 backend, 500 web module; workspace packages и Go evaluator также прошли. Добавленные затем native проверки прошли отдельно, 9/9. |
| `pnpm test:integration` | Полный прогон: 668 PASS; два старых списка миграций не учитывали новую миграцию, один зависимый тест пропущен. После обновления только этих ожиданий: migrations 9 PASS, home-series-pin 1 PASS. |
| Реальный HTTP adapter | 8 PASS вместе с существующим MCP HTTP набором. Новые import POST действительно возвращают объявленный 200; проверяются также ошибки и авторизация. |
| `pnpm check:ui` | Browser engines прошли; 562 Storybook-теста прошли, один clipboard-тест требовал детерминированного адаптера. После его исправления и добавления public disclosure все 5 practice stories прошли; финальная сборка Storybook прошла. Реальный clipboard проверен отдельно. |
| `pnpm check:web-e2e` | Сборка, prerender/standalone проверки, 171 e2e PASS с 17 штатными skips, 26 navigation PASS с 2 сравнительными skips. Исправлена обнаруженная регрессия предзагрузки бесплатного урока. |
| `pnpm smoke:fullstack` с фильтром `practice Reader` | 6 PASS: desktop/mobile, реальные import/access/Reader, private readiness, public 44px disclosure без сдвига actions при задержке 2000 мс, clipboard, setup HTTP 200, guest/denied. Отдельные Compose-проект и порты. |
| Native deterministic harness | 9 PASS: OAuth/S256/TTL, чтение и fingerprint, полнота контекста/точные criterion IDs/текущие файлы, runtime и cleanup gates, TERM→KILL для зависшего дочернего процесса. |

Обязательный `pnpm check` покрыт указанными этапами и адресными повторными прогонами после найденных
исправлений. Это локальные результаты; удалённый CI для точного PR head указывается отдельно в PR.
[Снимки и геометрия интерфейса](../evidence/issue-785/README.md).

## Реальные клиенты

Среда: macOS 27.0 arm64, Node 24.21.0, Codex CLI 0.157.1, Claude Code 2.1.283.
Оба клиента сами выполнили OAuth discovery/DCR/S256 вход через локальный синтетический сервер
авторизации. Использовались настоящий Platform HTTP MCP, verifier и learner composition;
identity, Materials и ContentAccess в native stand синтетические. Реальная база и импорт проверены
отдельным full-stack набором. TTL оставался 300 секунд, предел модельного запуска — 240 секунд.

[Таблица испытаний](../evidence/issue-785/native/matrix.json) содержит 51 запись: 40 автоматических
PASS по критериям, 2 TIMEOUT, 1 INVALID_HARNESS_INTERRUPTION и 8 строк ручной проверки. Исторический
protocol 1 для брифа/спецификации отделён от protocol 2 и целевых повторов после уточнения языка и
необязательных улучшений. Подготовительные отладочные запуски не являются приёмкой.

Codex в protocol 2 запрашивал `gpt-6-astra`; его JSON stream не сообщает фактическую модель, поэтому
это поле оставлено пустым. Исторические protocol 1 запуски использовали default без задним числом
назначенной модели. Claude init сообщает `claude-opus-5-5`. Текстовый Codex smoke дополнительно
сообщает `gpt-6-astra` в runtime output.

Автоматический gate сверяет успешные tool results всех частей, общие version/content pins,
контрольные суммы и конечный маркер, точные IDs всех критериев и наблюдаемые чтения текущих файлов.
Правильных статусов в итоговом тексте недостаточно. Отдельно нужны OAuth/PKCE, завершение без
таймаута, неизменный проект и успешный logout. Имена сценариев и oracle находятся вне выбранного
проекта и запроса, а не объявляются физически недоступными во всей файловой системе.

Два исходных Codex timeout сохранены: adversarial получил контекст и прочитал файлы, stale не дошёл
до tool events. Причина не установлена. Единственный диагностический повтор adversarial и отдельный
scoped stale прошли; успешные повторы не удаляют прежние исходы. Исходный recheck был прерван harness
и признан недействительным; отдельные baseline/recheck-after прошли под одним context pin. Два
завершённых запуска также содержат восстановленные stream/TLS warnings. Это не гарантия доступности
модели или сети.

## Независимая ручная проверка

Независимые Standards и Spec reviewers закрыли все существенные замечания для указанного диапазона.
Первоначальные замечания касались геометрии Reader, HTTP status и недостаточных условий успеха
native harness. Исправления проверены повторно; новые существенные замечания не обнаружены.

| Свидетельство | Ручное решение |
| --- | --- |
| [Codex scope](../evidence/issue-785/native/codex-brief-multiple-scoped.json), [Claude scope](../evidence/issue-785/native/claude-brief-multiple.json) | Пройдено: один вопрос о выборе worktree, решения не смешиваются. |
| [Codex discussion](../evidence/issue-785/native/codex-optional-dialogue.json), [Claude discussion](../evidence/issue-785/native/claude-optional-dialogue.json) | Пройдено: объяснение выбранного решения и один вопрос после полного отчёта, без обязательного квиза или новых требований. |
| [Codex human output](../evidence/issue-785/native/codex-human-output.md), [Claude human output](../evidence/issue-785/native/claude-human-output.md) | Полезный русский отчёт из фактического копируемого UI-запроса. У Claude в конце два связанных вопроса за один ход: наблюдаемое ограничение соблюдения формата, не PASS строгого правила «всегда один вопрос». |
| [Наблюдаемые команды](../evidence/issue-785/native/observed-boundary.md) | Проект/тесты не исполнялись. Чтение, `shasum` и один `python3 -I` со стандартной библиотекой; trap modules прочитаны как данные. Это наблюдение поведения, не жёсткий запрет любого исполнения. |
| Отрицательная запись | Claude не предоставляет write/shell tools, что видно в inventory. Codex сообщил отказ текстом без события вызова: этот model probe остаётся inconclusive. [Отдельный native sandbox engine probe](../evidence/issue-785/native/sandbox-engine.json) реально вернул exit 1 и сохранил sentinel; он не выдаётся за модельный вызов. |

Строки `MANUAL_REVIEW_PENDING` в исходной таблице сохраняют исходное машинное состояние; ручные
решения приведены выше отдельно. [Границы text-output smoke](../evidence/issue-785/native/human-output.json):
Claude text mode не раскрывает события Read; полный инструментальный proof чтения/pins находится
в JSON trials того же профиля. Текстовый smoke проверяет пользовательский вывод, а не повторяет всю
инструментальную проверку. Синтетические grants завершённых запусков отозваны; отдельно сохранён
[logout раннего прерванного запуска](../evidence/issue-785/native/earlier-interrupted-cleanup.json).

Примеры: [допустимая альтернатива](../evidence/issue-785/native/claude-feature-alternative.json),
[реальное нарушение](../evidence/issue-785/native/claude-feature-missed.json),
[устаревшее свидетельство](../evidence/issue-785/native/claude-feature-stale.json),
[полный recheck](../evidence/issue-785/native/codex-feature-recheck-after-scoped.json),
[дефект вместе с injection](../evidence/issue-785/native/codex-feature-adversarial-diagnostic-repeat.json).
Исходные local paths и SHA сохранены для происхождения результатов; raw transcripts и credentials
не включены в Git.

## Что этот результат не утверждает

Испытания не доказывают обучение, достоверность чужих логов, безопасность любого пользовательского
harness, других ОС/версий клиентов или произвольного Git доступа. Codex shell остаётся доступным
для чтения: no-project-execution — правило поведения, а runtime защищает запись в проверенных
границах. Клиенты могут писать собственные runtime данные вне учебного проекта.

Production OAuth/Logto onboarding, deploy, публикация курса и настоящий Content exporter практики
не выполнены. Адрес MCP в публичной инструкции остаётся placeholder до разрешённого выпуска.
Реальные задания первой главы затем заменят синтетические исходники через тот же import seam;
педагогическая пригодность потребует отдельной проверки на реальных работах.
