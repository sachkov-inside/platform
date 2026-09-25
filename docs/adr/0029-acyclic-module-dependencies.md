---
status: accepted
---

# Граф зависимостей Module без циклов

Инженерное ревью 24.09.2026 ([workspace#209](https://github.com/sachkov-inside/workspace/issues/209))
нашло, что восемь Module backend — billing, notifications, telegram-membership,
membership-entitlements, workshop, materials, content-access и videos — связаны в одну
сильно связную компоненту. Guardrail запрещал глубокие импорты, но циклы не видел. Runtime-цикл
через Membership Entitlements держался на `await import`, а часть экспортов `index.ts` не имела
потребителя. Решение принято в [platform#695](https://github.com/sachkov-inside/platform/issues/695).

## Решение

Граф зависимостей между Module ацикличен. Ребро `A -> B` появляется от любого импорта `index.ts`
Module B из файла Module A: значения, типа, реэкспорта или `await import()`. Type-only импорт при
сборке стирается, но связывает изменения двух Module так же, как значение, поэтому тоже считается.
`scripts/check-backend-architecture.mjs` строит граф по `src` и называет каждый цикл вместе с файлом
на каждом его ребре.

Известный цикл перечислен в `legacyCycleEdges` того же скрипта целиком: все рёбра компоненты
из восьми Module, у каждого самый сильный разрешённый вид импорта (`type`, `dynamic` или `value`).
При решении их было 24; [platform#732](https://github.com/sachkov-inside/platform/issues/732)
развернул пять, осталось 19.
Проверка ищет сильно связные компоненты по полному графу. Нарушение — любое ребро, лежащее на цикле,
которого нет в списке, и импорт сильнее разрешённого. Поэтому новое ребро падает, даже если замыкает
цикл только через перечисленные. Если ребро исчезло, ослабло или больше не лежит на цикле, guardrail
требует убрать или понизить запись. Новых записей в список не добавляют: новое ребро, которое
замыкает цикл, разворачивается через port потребителя или переносом общего значения ниже по графу.

Interface Module — только то, что используют снаружи. `index.ts` экспортирует символ, лишь пока
его импортирует код вне Module: `src`, `test` или `scripts`. Module импортирует собственные файлы
напрямую, а не через свой `index.ts`. Обе проверки выполняет тот же скрипт.

## Рёбра, которые нужно развернуть

Остальные 14 рёбер списка идут от потребителя к поставщику и остаются, когда эти пять развёрнуты.

| Ребро | Вид | Почему осталось | Что его убирает |
|---|---|---|---|
| workshop → materials | `type` | `MaterialId` в interface Workshop | Импорт `MaterialId` из `infrastructure/contracts/material-id.ts`, как в Content Access |
| content-access → workshop | `type` | Факты доступа Workshop в зависимостях Content Access | Port фактов у Content Access |
| workshop → membership-entitlements | `type` | Зависимость выдачи прав Workshop описана типом Membership Entitlements | Port Workshop |
| materials → notifications | `type` | Анонсы Materials реализуют `NotificationSource` | Port источника, который описывает сам Materials |
| billing → notifications | `type` | Уведомления Billing реализуют `NotificationSource` | То же для Billing |

Развёрнуты в platform#732:

- membership-entitlements → materials и membership-entitlements → telegram-membership (`dynamic`).
  Membership Entitlements описывает port `ContentScopeCatalog` и `RecipientLinks` в `ports/` и
  получает их по токенам `CONTENT_SCOPE_CATALOG` и `RECIPIENT_LINKS`. Реализации лежат в Materials
  (`ContentScopeCatalogModule`) и Telegram Membership (`RecipientLinksModule`). Это глобальные
  модули Nest: иначе Membership Entitlements пришлось бы импортировать своих реализаторов.
  Каждый процесс, который загружает Membership Entitlements, подключает оба модуля в entrypoint.
  Без них процесс не стартует, это проверяют тесты композиции API, MCP и обоих workers.
- content-access → materials (`type`). Бренд `MaterialId` и его конструктор лежат в
  `src/infrastructure/contracts/material-id.ts` ниже всех Module; Materials реэкспортирует их.
- content-access → membership-entitlements (`type`). Content Access сам описывает нужный ему срез
  решений о членстве; Membership Entitlements подходит к нему структурно.
- billing → telegram-membership (`type`). Активация подписки в Billing описывает связи типом
  `RecipientLinks` из Membership Entitlements, от которого Billing уже зависит.

Runtime-ребро workshop → materials убрано: адаптер каталога материалов Workshop не использовался
в production и перенесён в единственный тест, который его собирал.

## Последствия

- Новый цикл между Module, в том числе только по типам, ломает `pnpm --filter @inside/backend
  guardrails` с названием цикла.
- Список `legacyCycleEdges` может только сокращаться. Разворот любого ребра из таблицы — отдельное
  изменение с собственной задачей; когда цикл распадается, прямые рёбра уходят из списка вместе с ним.
- Неиспользуемый экспорт `index.ts` ломает ту же проверку, поэтому interface Module не растёт
  «на будущее». Symbol, который нужен только внутри Module, остаётся в его файлах.
