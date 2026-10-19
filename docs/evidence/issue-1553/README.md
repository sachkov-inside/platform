# Кнопка «Поделиться» — #1553

Production-owned `MaterialShareButton` используется карточками `feed`, `row`, `series` и шапкой Reader, включая закрытый teaser. Снимки сделаны из настоящих компонентов в Storybook на 1440 и 390 px; горизонтального переполнения нет. Снимки просмотрены.

- [Карточки, desktop](share-cards-1440.png)
- [Карточки, mobile](share-cards-390.png)
- [Ручное копирование, mobile](share-manual-390.png)

В браузере WebKit выполнены play-сценарии CopyLink, NativeMenu, CancelMenu, ManualCopy и NativeUnavailable: постоянный URL, отмена без копирования и выделение ручного адреса. Нативный share подменён; реальные сообщения не отправлялись. Проверка axe WCAG 2 A/AA и 2.1 AA карточек и Reader на 1440/390 px: 0 нарушений, без горизонтального переполнения. Для Reader использованы соответствующие Desktop/Mobile stories. Проверены четыре существующих Home LoadsInPlace сценария. CI обнаружил смещение названия на22px в DesktopRouteDetails; компактный share внутри строки устранил смещение, исходный play прошёл в браузере. CompactManualCopy проверен на320px, включая200% текста без переполнения.

Локальный MCP test-run имеет известный сбой «No test suite found» в кириллическом worktree (#1551). Он не считается успешным тестом и не заменяет provider Storybook CI. Production navigation tests проверяют системный share и ручной адрес на реальных маршрутах; их результат записывается в PR.

Это функциональный semantic UI. Окончательное визуальное согласование — #1554. Счётчик читателей и новый сбор аналитики не включены: модель ожидает решения владельца по существующему контракту author-analytics-measurement-v1.
