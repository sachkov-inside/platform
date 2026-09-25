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

Нарушение — любое ребро, которое лежит на цикле: проверка ищет сильно связные компоненты по
полному графу. Ребро, которое замыкает цикл, разворачивается одним из трёх способов:

- port потребителя: нижний Module описывает нужную ему способность, верхний её реализует;
- ответ реализатора: когда потребитель стоит выше реализатора, как Notifications над Materials и
  Billing, реализатор сам описывает свой ответ, а потребитель принимает его структурно;
- перенос общего значения, например бренда идентификатора, ниже всех Module.

Interface Module — только то, что используют снаружи. `index.ts` экспортирует символ, лишь пока
его импортирует код вне Module: `src`, `test` или `scripts`. Module импортирует собственные файлы
напрямую, а не через свой `index.ts`. Обе проверки выполняет тот же скрипт.

## Как цикл был развёрнут

При решении цикл из 24 рёбер был перечислен в списке разрешённых рёбер guardrail. Десять из них
развернули в [platform#732](https://github.com/sachkov-inside/platform/issues/732), после чего
остальные 14 перестали лежать на цикле, и список вместе с его проверками удалён.

- Membership Entitlements описывает port `ContentScopeCatalog` и `RecipientLinks` в `ports/` и
  получает их по токенам `CONTENT_SCOPE_CATALOG` и `RECIPIENT_LINKS` вместо `await import`.
  Реализации лежат в Materials (`ContentScopeCatalogModule`) и Telegram Membership
  (`RecipientLinksModule`). Это глобальные модули Nest: иначе Membership Entitlements пришлось бы
  импортировать своих реализаторов. Каждый процесс, который загружает Membership Entitlements,
  подключает оба модуля в entrypoint. Без них процесс не стартует; это проверяют тесты композиции
  API, MCP и обоих workers.
- Бренд `MaterialId` и его конструктор лежат в `src/infrastructure/contracts/material-id.ts` ниже
  всех Module; Materials реэкспортирует их, Content Access и Workshop импортируют оттуда.
- Content Access сам описывает нужные ему решения о членстве и доступе Workshop; Workshop реализует
  port доступа и описывает решение о членстве под блокировкой выдачи. Materials и Billing сами
  описывают ответ источника уведомления, Notifications принимает его структурно.
- Активация подписки в Billing описывает связи типом `RecipientLinks` из Membership Entitlements, от
  которого Billing уже зависит.
- Runtime-ребро workshop → materials убрано ещё в platform#695: адаптер каталога материалов
  Workshop не использовался в production и перенесён в единственный тест, который его собирал.

## Последствия

- Новый цикл между Module, в том числе только по типам, ломает `pnpm --filter @inside/backend
  guardrails` с названием цикла.
- Неиспользуемый экспорт `index.ts` ломает ту же проверку, поэтому interface Module не растёт
  «на будущее». Symbol, который нужен только внутри Module, остаётся в его файлах.
