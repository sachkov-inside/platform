# Personal Home production evidence — #332

**Composition update, 2026-09-07:** the owner rejected the separate continue block.
The full-stack evidence below covers the earlier implementation; it does not accept the new
inline Series/Video composition. The current Storybook uses the new presentation with fixtures.

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

Откройте `Pages / Progress walkthrough / 1. Проверить весь путь`. Верхняя панель — только для
проверки. На главной нет отдельного блока продолжения: текущая серия и недосмотренное видео
стоят первыми в своих обычных секциях. Гайды и остальные карточки сохраняют прежний вид.

1. В «Сериях» нажмите «Создание Platform Inside» с подписью «Продолжить · изучено 1 из 3».
   Откроется следующий неизученный материал, видео, с навигацией по серии.
2. Нажмите «Просмотрено», затем выберите «Серия»: теперь изучено 2 из 3; у текста и видео галочки.
3. На «Главной» эта же серия ведёт уже к гайду. Подпись «Продолжить с 4:03» у видео исчезла.
4. Снимите отметку с видео: счётчик уменьшится, продолжение серии снова ведёт к видео.

Также доступны «Всё изучено», «Ошибка сохранения», «Видео досмотрено» и «Без истории».
Досмотренное видео не продвигается как недосмотренное. Полностью изученная серия перестаёт
предлагать продолжение. Сами материалы и серии остаются в публичной витрине.

Отметки и порядок продолжения в этом примере меняются в памяти Storybook. API и плеер не
вызываются; новая серверная проекция серии ещё не подключена. Снимки `walkthrough-*` показывают
актуальный демонстрационный вариант; остальные снимки — прежний full-stack proof.
