# Проверка интерфейса воронок — #308

Проверено 6 сентября 2026 года. Реальный маршрут `/authoring/communications` и Storybook используют
один production-owned компонент. Это функциональная семантическая реализация; окончательное
визуальное принятие и замена временного модуля остаются в [#316](https://github.com/sachkov-inside/platform/issues/316).
Owner visual GO этим документом не заявляется.

## Сквозной сценарий

`apps/web/test/fullstack/communications.spec.ts` прошёл в Chromium на 1440×1024 и 390×844:

- подтверждённый автор открывает список и сохраняет общее знакомство;
- создаёт воронку с непосредственным ответом, отложенным шагом и источником;
- Save оставляет неопубликованный черновик, Preview показывает новый шаг;
- Publish, Pause и Resume меняют сохранённое состояние;
- после перезагрузки данные восстанавливаются из provider;
- ссылка на отсутствующий материал даёт ошибку в Preview и убирает возможность Publish;
- axe не находит нарушений в `#authoring-content`, горизонтального переполнения нет;
- Tab переводит фокус с названия на переключатель стандартной воронки.

Стенд использовал настоящий Next.js BFF, Nest API, Materials PostgreSQL и Telegram provider
из [PR #36](https://github.com/sachkov-inside/inside-telegram/pull/36), commit `9f63550`.
Проверка автора проходила через настоящий callback provider → Platform. Браузерные запросы
не подменялись. Локальная identity/JWKS и связанный Account были синтетическими fixtures.
Каждое приложение имело отдельную базу в изолированном тестовом PostgreSQL. Фоновые workers
и Telegram delivery были отключены; внешние Telegram credentials не использовались.

Запуск теста требует такого изолированного стенда, связанного автора с `communications:manage`
и короткоживущей сессии, созданной стандартным full-stack fixture:

```bash
FULLSTACK_COMMUNICATIONS=true \
FULLSTACK_WEB_BASE_URL=http://127.0.0.1:3319 \
FULLSTACK_LOGTO_COOKIE_NAME=logto_inside-web-fullstack \
pnpm --filter @inside/web test:fullstack communications.spec.ts
```

`FULLSTACK_LOGTO_SESSION` передаётся через окружение. Без явного
`FULLSTACK_COMMUNICATIONS=true` отдельный сценарий пропускается: общий smoke не предоставляет
communications provider и подтверждённую Telegram-связь. Сессии и локальные fixture-данные
не входят в репозиторий.

## Изображения

| Поверхность | Desktop | Mobile |
| --- | --- | --- |
| Storybook, подготовленный Preview | [1440×1024](story-desktop.png) | [390×844](story-mobile.png) |
| Реальный маршрут, синтетические сохранённые воронки | [1440×1024](live-desktop-chromium.png) | [390×844](live-mobile-chromium.png) |

Снимки показывают верх страницы; последующие действия и проверки ошибок выполняет сквозной тест.
Storybook содержит девять состояний: существующая/пустая воронка, загрузка, отсутствие прав,
конфликт, Preview, недоступный target, multipart на мобильном экране и неизвестный результат доставки.

## Граница доказательств

Проверены локальные операции и реальные границы приложений. Реальный вход пользователя в бота,
credentialed Telegram sends, доставка по времени и итоговая production-конвергенция не проверялись
этим browser-сценарием. Provider PostgreSQL integration suite отдельно проверяет scheduling,
multipart, idempotency и историю; итоговый общий сценарий принадлежит #310.

Исторический rollback остаётся существующим API-путём из #307 и не входит в новый редактор.
Его проверка обещанных targets требует расширения provider-контракта и явно записана в #310.
