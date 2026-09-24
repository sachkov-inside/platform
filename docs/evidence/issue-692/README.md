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

Карточка — принятое состояние урока и подборки (`StatusPanel`), новой визуальной формы нет.
Программа руководства и шрифт выглядят как раньше: это проверяют stories `LoadsInPlace` и
программы, e2e шрифта и набор переходов на production-сборке.
