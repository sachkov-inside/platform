# Юридический раздел: снимки состояний (#412)

Дата: 12.09.2026. Ветка `feat/412-legal-pages`, локальный `pnpm dev` на порту 3261,
бэкенд не требуется: страницы собираются из пакета `@inside/legal`.

| Файл | Страница | Экран |
| --- | --- | --- |
| `legal-section-desktop.png` | `/legal` | 1440×2200 |
| `legal-section-mobile.png` | `/legal` | 390×1600 |
| `legal-purchase-desktop.png` | `/legal/purchase` | 1440×2200 |
| `legal-purchase-mobile.png` | `/legal/purchase` | 390×1600 |
| `legal-edition-desktop.png` | `/legal/terms/v1` | 1440×2200 |
| `legal-edition-mobile.png` | `/legal/terms/v1` | 390×1600 |

Формы сняты из собранного Storybook (`pnpm build:storybook`, статика отдаётся локально) на тех же
двух ширинах:

| Файл | История | Что показывает |
| --- | --- | --- |
| `checkout-subscription-{desktop,mobile}.png` | `Pages/Subscription/Checkout · Consents Not Prechecked` | Согласия названы документом, ни одно не отмечено заранее, ниже ссылки на документы покупки |
| `checkout-one-time-{desktop,mobile}.png` | `Pages/Subscription/Checkout · One Time Guide` | Разовая покупка без согласия на списания |
| `billing-contact-{desktop,mobile}.png` | `Pages/Account/Billing contact · Legal Documents` | Один список документов рядом с формой email |
| `account-profile-{desktop,mobile}.png` | `Pages/Account/Profile · Active · desktop` | Объяснение видимости профиля и ссылка на политику |

Кадр раздела берётся высоким, а не `fullPage`: на десктопе прокручивается оболочка приложения, и
`fullPage` обрезал бы страницу по высоте окна.

Что видно на снимках: раздел перечисляет действующие документы с датой начала действия и
кратким назначением; страница документа показывает принятый текст, номер редакции, её
постоянный адрес и контрольную сумму; футер с ссылками и краткими сведениями продавца
присутствует и на телефоне, и на компьютере.

Проверки доступности и поведения маршрутов выполняет `apps/web/test/e2e/legal.spec.ts`
(axe без серьёзных замечаний на `/legal` и `/legal/privacy`, 404 на неизвестном документе,
переход из футера). Состояния раздела и документа также собраны в Storybook:
`Pages/Legal/Раздел` и `Pages/Legal/Документ`.
