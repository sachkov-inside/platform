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

Известный цикл перечислен в `legacyCycleEdges` того же скрипта целиком: все 24 ребра компоненты
из восьми Module, у каждого самый сильный разрешённый вид импорта (`type`, `dynamic` или `value`).
Проверка ищет сильно связные компоненты по полному графу. Нарушение — любое ребро, лежащее на цикле,
которого нет в списке, и импорт сильнее разрешённого. Поэтому новое ребро падает, даже если замыкает
цикл только через перечисленные. Если ребро исчезло, ослабло или больше не лежит на цикле, guardrail
требует убрать или понизить запись. Новых записей в список не добавляют: новое ребро, которое
замыкает цикл, разворачивается через port потребителя или переносом общего значения ниже по графу.

Interface Module — только то, что используют снаружи. `index.ts` экспортирует символ, лишь пока
его импортирует код вне Module: `src`, `test` или `scripts`. Module импортирует собственные файлы
напрямую, а не через свой `index.ts`. Обе проверки выполняет тот же скрипт.

## Рёбра, которые нужно развернуть

Остальные 14 рёбер списка идут от потребителя к поставщику и остаются, когда эти десять развёрнуты.

| Ребро | Вид | Почему осталось | Что его убирает |
|---|---|---|---|
| membership-entitlements → materials | `dynamic` | `ACCESS_GRANTS` читает `ContentScopeCatalog`, а Materials статически зависит от Membership Entitlements. Провайдер берёт класс через `await import` после загрузки Module, иначе Nest и порядок загрузки ESM упираются в цикл | Port каталога областей контента у Membership Entitlements, который реализует Materials |
| membership-entitlements → telegram-membership | `dynamic` | `TributeSources`, `MEMBERSHIP_ENTITLEMENTS` и `ACCESS_GRANTS` берут `TelegramAccountLinks` так же, потому что Telegram Membership зависит от Membership Entitlements | Port связей получателя, который реализует Telegram Membership |
| content-access → materials | `type` | `MaterialId` в interface и зависимостях Content Access | Перенос `MaterialId` в место без зависимостей |
| workshop → materials | `type` | `MaterialId` в interface Workshop | То же |
| content-access → workshop | `type` | Факты доступа Workshop в зависимостях Content Access | Port фактов у Content Access |
| content-access → membership-entitlements | `type` | Типы решений о доступе в зависимостях Content Access | То же |
| workshop → membership-entitlements | `type` | Зависимость выдачи прав Workshop описана типом Membership Entitlements | Port Workshop |
| materials → notifications | `type` | Анонсы Materials реализуют `NotificationSource` | Port источника, который описывает сам Materials |
| billing → notifications | `type` | Уведомления Billing реализуют `NotificationSource` | То же для Billing |
| billing → telegram-membership | `type` | Активация подписки получает `TelegramAccountLinks` по типу | Port связей в Billing |

Runtime-ребро workshop → materials убрано: адаптер каталога материалов Workshop не использовался
в production и перенесён в единственный тест, который его собирал.

## Последствия

- Новый цикл между Module, в том числе только по типам, ломает `pnpm --filter @inside/backend
  guardrails` с названием цикла.
- Список `legacyCycleEdges` может только сокращаться. Разворот любого ребра из таблицы — отдельное
  изменение с собственной задачей; когда цикл распадается, прямые рёбра уходят из списка вместе с ним.
- Неиспользуемый экспорт `index.ts` ломает ту же проверку, поэтому interface Module не растёт
  «на будущее». Symbol, который нужен только внутри Module, остаётся в его файлах.
