# Локальный интерфейс #624

Снимки показывают production-owned компоненты и синтетические данные. Owner visual GO ещё не
получен; эти артефакты предназначены для независимой проверки владельцем перед merge.

- [Кабинет desktop](cabinet-desktop.png), [mobile](cabinet-mobile.png).
- [Назначения владельца desktop](owner-desktop.png), [mobile](owner-mobile.png).
- [Storybook кабинет desktop](storybook-cabinet-desktop.png), [mobile](storybook-cabinet-mobile.png).
- [Storybook каталог владельца desktop](storybook-owner-desktop.png), [mobile](storybook-owner-mobile.png).

`pnpm smoke:enrollments` поднимает собственные PostgreSQL Testcontainers, настоящий Nest API и
Next, выдаёт синтетическую короткую сессию и запускает desktop/mobile Playwright. Проверяет
создание тарифа без продажи, выбор Guide по названию, назначение за курс, состав и отсутствие
списания в открытом кабинете, отзыв/восстановление и обновление соседней вкладки. Проверки axe
WCAG 2 A/AA, 2.1 AA не обнаружили serious/critical нарушений на обеих живых поверхностях.
Скриншоты запуска лежат в `apps/web/test-results/`; fixture services удаляются после запуска.

Storybook: `pnpm storybook`, истории `Components/Billing/Enrollment list` и
`Pages/Authoring/Billing admin/Assignment Only Tier`. Пройдены responsive rendering и axe на
1440×1024 и 390×844. Stories используют те же UI модули; fixtures не входят в production graph.

Это локальная проверка Platform. Настоящие source authorities, Telegram/Tribute, банковские
операции, migration на production и полная межрепозиторная приёмка относятся к отдельным этапам.
