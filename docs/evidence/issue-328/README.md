# Ручные отметки: визуальная проверка #328

Контракт: [#323](https://github.com/sachkov-inside/platform/issues/323),
proof: [#328](https://github.com/sachkov-inside/platform/issues/328).
Реальные transport, cache invalidation и сквозная приёмка поставляются в
[#329](https://github.com/sachkov-inside/platform/issues/329).

Storybook `Pages/Reading progress` использует production-owned ReadingAction, MaterialReadingStatus
и SeriesProgress; fixture меняет состояние только внутри stories. Reader получает отдельные
presentation slots, карточки всех четырёх вариантов — один status slot. Личные поля не добавлены
в публичную Material projection. Новое действие заменяет старую video watched кнопку только
когда Reader получает readingAction; VideoPlaybackProgress остаётся самостоятельным фактом.

Проверка включает text/video/guide/unknown format, anonymous, free non-member, member, expired,
unavailable, loading, pending, failure/retry, stale conflict, keyboard mark/unmark, пустую
и завершённую серию. Неактивное действие объясняет причину, ошибка сохраняет прежний статус,
конфликт показывает актуальный. Серия использует «Изучено N из M» без процентов.

Команды из корня репозитория:

```bash
pnpm --filter @inside/web exec storybook dev -p 6006 --no-open --ci
pnpm --filter @inside/web exec playwright test --config playwright.reading-proof.config.ts
```

Автоматическая проверка снимает 390×844 и 1440×1024, проверяет отсутствие горизонтального
переполнения, accessibility через Axe и устойчивый размер кнопки при pending. Agentation скрыт
только в автоматических снимках; интерактивный Storybook оставляет overlay включённым.

Owner visual GO: ожидается. Эти снимки не означают завершение production integration #329.
