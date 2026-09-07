# Мобильная навигация — #381

Проверено 7 сентября 2026 года. Скриншоты показывают production-owned ApplicationShell
в Storybook и в production build Next.js с локальным API и PostgreSQL.
Визуальная приёмка владельцем и проверка физического iPhone остаются открытыми.

| Поверхность | Desktop 1440×1024 | Mobile 390×844 |
| --- | --- | --- |
| Реальный публичный маршрут | [База знаний](live-desktop.png) | [База знаний](live-mobile.png) |
| Storybook | [Оболочка](story-desktop.png) | [Переключение вкладок](story-mobile.png) |

В реальном маршруте используются демонстрационные материалы локальной базы.
Storybook показывает fixtures; его кнопка Agentation доступна только в среде разработки.
Снимки фиксируют конечные состояния. После обратной связи владельца переходы страниц через
ViewTransition удалены: страница и нижняя панель больше не участвуют в fade-out/fade-in.
Анимация остаётся только у элементов нижней навигации. Само ощущение переключения проверяется
в работающей версии.

## Проверки поведения

- `pnpm check`: полный набор проверок пройден. Web: 482 теста, backend: 420;
  маршрутные проверки: 51 passed, 13 предусмотренных skips.
- `pnpm --filter @inside/web test:e2e mobile-navigation.spec.ts --project=mobile-chromium --workers=1`:
  восемь сценариев — URL/scroll, предзагрузка, быстрые клики, геометрия 320/390/430,
  reduced motion/axe, ошибка и 401, native Back, смена accountId.
- `API_PORT=3812 FULLSTACK_WEB_PORT=3814 FULLSTACK_MCP_PORT=3813 FULLSTACK_TEST_GREP='mobile navigation' pnpm smoke:fullstack`:
  production build, реальный API/БД и backend/MCP smoke прошли. Identity интеграционного стенда
  синтетическая; реальные Telegram credentials не использовались.
- Повтор тех же fullstack-сценариев на запущенной проверочной версии: 3 passed,
  один desktop skip для исключительно мобильного сценария.
- Standards и Spec review от `42f086edb6a5086cdffbbfeb613bbf9036089a6b`: замечания закрыты.

Дополнительный regression test `mobile navigation stays mounted without fading the document during tab changes`
сэмплирует кадры реального перехода в production build: панель остаётся тем же видимым DOM-узлом
на прежнем месте, анимации снимков страницы отсутствуют. До исправления тест падал на
`public-page-fade`.

## Границы

Первое открытие на холодной медленной сети сохраняет loading. Тесты Chromium не доказывают цвет
внешних панелей Safari: это проверяется на настоящем iPhone. Авторизация реального пользователя
и production deploy в эту проверку не входят. Изменения доступа на сервере отсутствуют.
