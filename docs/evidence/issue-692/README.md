# Страницы 404 и ошибок в оболочке — #692

Снимки ветки `fix/692-web-stability-errors`. Горизонтального переполнения нет:
`scrollWidth − clientWidth = 0` на обеих ширинах. Снимки обрезаны выше строки реквизитов в
подвале.

| Файл | Что показывает |
|---|---|
| `not-found-live-desktop.png` | 1440 px, живой адрес `/does-not-exist`: «Страница не найдена» в публичной оболочке, ответ 404 |
| `not-found-live-mobile.png` | 390 px, тот же адрес: карточка, подвал и мобильная навигация |
| `unexpected-error-story-desktop.png` | 1440 px, story `Pages/Mobile-first Platform/Route states → Unexpected error · desktop`: сбой страницы с «Повторить» и «На главную» |
| `unexpected-error-story-mobile.png` | 390 px, та же story на телефоне |
| `layout-error-story-desktop.png` | 1440 px, story `Route states/Without shell → Layout error`: сбой раскладки раздела или корня (`app/error.tsx`, `global-error.tsx`), оболочки уже нет |
| `layout-error-story-mobile.png` | 390 px, та же story |
| `authoring-error-story-desktop.png` | 1440 px, story `Route states/Without shell → Authoring error`: сбой авторского раздела в авторской оболочке, текст на русском |
| `authoring-error-story-mobile.png` | 390 px, та же story |

Карточка — принятое состояние урока и подборки (`StatusPanel`), новой визуальной формы нет.
Программа руководства и шрифт выглядят как раньше: это проверяют stories `LoadsInPlace` и
программы, e2e шрифта и набор переходов на production-сборке.

## Замер `zod/mini`

Production-сборка, набор переходов с подставным backend, gzip скриптов первой загрузки, 24.09.2026.

| Вариант | Чанк `zod` на публичной странице | Все скрипты Главной |
|---|---|---|
| Как в `main`: классический `zod` | 64,6 КБ | 483,8 КБ |
| Весь web и пакеты `material-blocks`, `access-capabilities` на `zod/mini` | 58,2 КБ | 477,6 КБ |

Turbopack кладёт ядро `zod` в чанк целиком, поэтому `zod/mini` экономит только обёртку API —
около 6 КБ, 1,3% скриптов. Цена перевода — около 150 файлов web, два общих с backend пакета и
правка описаний MCP-инструментов backend. Владелец 24.09.2026 решил перевод не делать.
