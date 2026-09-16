# Platform #658: принятие условий кнопкой, журнал принятия, профиль только для владельца

Семь production-owned поверхностей в Storybook сняты при 1440×1024 (`*-desktop.png`) и 390×844
(`*-mobile.png`) на дереве поверх `origin/main` `80722758`:

| Кадр | История | Что видно |
| --- | --- | --- |
| `welcome-*` | `Pages/Welcome › FirstSignIn` | Экран первого входа: «Аккаунт создан», кнопка «Принять условия и продолжить», строка о принятии условий, возраст от 14 лет, ссылки на условия и политику. Отметок нет |
| `checkout-one-time-*` | `Pages/Guide/Payment › Ready` | Разовая покупка: сводка условий и документы покупки из #650, кнопка «Оплатить 2 500 ₽», строка «Нажимая «Оплатить», вы принимаете оферту разовой покупки» и строка о законном представителе до 18 лет |
| `checkout-subscription-*` | `Pages/Subscription/Checkout › AcceptanceByButton` | Подписка: кнопка «Оформить подписку и оплатить», строка об оферте подписки и автопродлении с суммой, днём следующего списания, периодом и местом отключения |
| `subscription-resume-*` | `Pages/Account/Subscription › Canceled` | Возобновление: кнопка «Возобновить автопродление» и строка условий следующего списания |
| `storage-notice-*` | `Patterns/Storage notice › NewEdition` | Уведомление о хранении в браузере по cookies v2: без выбора, ссылка «Подробнее», кнопка «Понятно» |
| `accepted-documents-*` | `Pages/Account/Access › Linked` | Блок «Принятые документы»: дата, подпись кнопки, редакция со ссылкой, показанные условия подписки; ссылки на политику v3 и cookies v2 |
| `profile-*` | `Pages/Account/Profile › Active · desktop` | Профиль «виден только вам», без ссылки для участников |

`results.json` для каждого кадра: горизонтального переполнения нет, отметок (`checkbox`) на
поверхности нет, serious/critical нарушений axe WCAG 2/2.1 A/AA нет. Agentation скрыт только для
снимка и axe.

На полностраничных кадрах телефона плавающая нижняя навигация оболочки закрывает часть текста в
середине: она фиксирована к окну, а снимок склеивает всю высоту. Текст под ней виден на кадре
компьютера.

Воспроизведение из корня checkout на pinned Node/pnpm:

```bash
pnpm --filter @inside/web exec storybook dev --ci --no-open -p 3411
# Во втором терминале; каталог вывода выбирается отдельно от сохранённых доказательств.
STORYBOOK_URL=http://127.0.0.1:3411 node docs/evidence/issue-658/capture.mjs /tmp/platform658-new-evidence
```

Это визуальное доказательство настоящих компонентов с fixture-данными, не вход через настоящий
Logto, не реальная оплата и не production. Путь через сервер проверяют тесты:

- экран первого входа после входа по почте — `apps/web/test/identity/identity-proof.spec.ts`,
  после входа через Telegram — `apps/web/test/identity/telegram-sign-in.spec.ts`;
- закрытые до принятия кабинет, покупки и связка с ботом, журнал и список принятых документов —
  `apps/backend/test/integration/accounts-api.test.ts`, `legal-acceptances.test.ts`,
  `billing-contact.test.ts`, `telegram-account-sign-in.test.ts`;
- отсутствие страницы и аватара чужого профиля — `accounts-api.test.ts`,
  `member-profiles.test.ts`, `apps/web/test/fullstack/member-profile.spec.ts`.
