---
status: accepted
---

# Задание — отдельный Module, а не Material

Владелец 05.10.2026 принял модель курса: глава Guide содержит одно или несколько заданий, ученик
сдаёт задание через учебный MCP, автор видит сдачи и отвечает комментарием
([спецификация #939](https://github.com/sachkov-inside/platform/issues/939),
[решение в Inside Content](https://github.com/sachkov-inside/inside-content/blob/main/docs/course/decisions.md#принято-главы-и-задания-задание--отдельная-сущность-platform--05102026)).
До этого Platform знала только практику урока: одно определение на урок-материал, одна текущая
версия, повторный импорт перезаписывал прежние критерии.

## Решение

Задание (Guide Task) живёт в собственном Module `guide-tasks` со своей схемой Postgres
`guide_tasks` по [ADR 0003](0003-one-postgresql-schema-per-state-owning-module.md). Module владеет
заданием, его неизменяемыми версиями требований (Task Version), сдачами учеников (Task Submission)
и комментарием автора (Author Feedback).

Задание не Material. [ADR 0009](0009-one-mutable-material.md) держит Materials вокруг одного
изменяемого тела, а у задания неизменяемые версии и записи учеников, которые только добавляются.
Если сделать задание видом материала, Materials получили бы второй жизненный цикл тела и чужие
данные учеников.

Задание не элемент главного пути Guide. Оно принадлежит одной главе Guide и имеет свой порядок
внутри главы, отдельный от `ordinal` материалов. Порядок Guide, Guide Progress, расчёт `guideIds`
и MCP composition не меняются. Отвергнутый вариант — задание как второй вид элемента главного пути:
он менял все четыре места ради свободного чередования с материалами, которого программа курса не
требует.

Зависимости по [ADR 0029](0029-acyclic-module-dependencies.md):

- `guide-tasks` читает Guide, главы и материалы по source ID через `GuideDirectory` из Materials и
  решения ContentAccess;
- ContentAccess решает доступ к заданию как к новому виду ресурса и описывает port
  `GuideTaskResourceFactsAdapter`; `guide-tasks` реализует его в глобальном
  `GuideTaskResourceFactsModule`, как Materials реализует каталог ContentScope;
- `content-library` (учебный MCP) зависит от `guide-tasks`: Module задания сам регистрирует свои
  инструменты и prompt `review_task` на учебном endpoint;
- Materials и ContentAccess не импортируют `guide-tasks`.

## Последствия

- Каждый процесс, который загружает Materials (API, MCP, notifications worker), подключает
  `GuideTaskResourceFactsModule` в entrypoint; без него Nest не соберёт ContentAccess.
- Доступ к заданию: `free` открыт всем, `membership` открыт с правом на Guide задания или с
  `materials`, чей ContentScope покрывает этот Guide; снятое с публикации задание видит только
  автор (`materials:manage`).
- Версия требований меняется только с digest определения. Сдача ссылается на свою версию и не
  копирует критерии. Триггеры базы запрещают изменять и удалять версии и сдачи.
- Практика урока (`PracticeDefinition`, `learning_practice_read`) работает рядом, пока Content не
  переведёт главы 0–1 на задания; её вывод из работы — отдельная задача.
- Вернуть задание внутрь Materials дорого: пришлось бы перенести схему, сдачи и port ContentAccess.
