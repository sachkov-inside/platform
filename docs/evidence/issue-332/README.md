# Personal Home production evidence — #332

Validation: 26 real full-stack browser scenarios passed at 390×844 and 1440×1024 (16 Home +
10 reading-progress scenarios); all 195 PostgreSQL integration tests passed.

The production route uses private BFF, real API, PostgreSQL and the locally issued authenticated
Account sessions. Text open/mark/unmark, retry with the same command, account switching, anonymous
Home, personal failure, visible-only emission and SSR hydration are checked in Playwright.
Video evidence uses the actual Videos playback session and saved PostgreSQL progress. Only the
external Kinescope iframe SDK is a local double: this is not credentialed Kinescope proof.

Visibility edge tests control document.visibilityState. They verify that the first signal waits
for visibility and that a retry retains the original command after hiding and restoring the tab.
The Membership expiry/rejoin scenario changes the local fixture through the real entitlement
owner using a development-only CLI; it preserves and compares the same database visit.

Owner production visual GO is pending. Screenshots and automation do not replace that decision.

The empty personal layer reserves enough height for its error and retry message. Ready-list and
empty-list background failures and authenticated SSR hydration preserve the Series position.

## Связанная проверка в Storybook

Откройте `Pages / Progress walkthrough / 1. Проверить весь путь`. Панель над Platform относится
только к Storybook; она позволяет переключать поверхности без потери состояния примера.

1. Откройте текст из «Продолжить изучение» и нажмите «Прочитано».
2. Выберите «Серия»: счётчик станет «Изучено 1 из 3», у текста появится отметка.
3. Выберите «Карточки», затем «Главная»: отметка видна на карточке, текст исчез из продолжения.
4. Вернитесь в «Материал» и снимите отметку: текст снова появится на главной.

В том же разделе есть состояния «Всё изучено», «Ошибка сохранения» и «Видео досмотрено».
В последнем конец видео сам не ставит отметку; кнопка «Просмотрено» убирает карточку.
Дополнительные состояния доступа, загрузки и конфликта находятся в `Pages / Reading progress`,
состояния главной — в `Pages / Personal Home`.

Это связанные демонстрационные данные в памяти Storybook, без API, сохранения между перезагрузками
и воспроизведения видео. Все три материала примера уже открывались, поэтому снятие отметки
возвращает их в продолжение. Используются production presentation и та же композиция Series;
это не отдельный дизайн страниц. Проверены переходы, управление клавиатурой и связь отметок
при 390×844 и 1440×1024. Снимки `walkthrough-*` относятся к этому примеру, не к backend proof выше.
