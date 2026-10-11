# Предупреждение перед продажей подписки всем — UI proof

Отдельный прототип для решения владельца по [#781](https://github.com/sachkov-inside/platform/issues/781).
Ветка `prototype/781-subscription-sale-confirmation`, исходный `origin/main`:
`f5a6d87597d0d3b5408d6bf25fc474c41ca8d06b`. В production прототип не подключён.

## Предмет решения

Один native dialog по существующей структуре
`ProductRemovalConfirmationDialog`: те же tokens, типографика и Button.
Фон — настоящий `TariffsView` в `AccessSection` и авторской оболочке.
Показана одна вкладка «Тарифы» с демонстрационным предложением «Материалы»:
сохранён допуск «Всем», продажа выключена, есть вариант подписки.

Заголовок: **«Включить продажу подписки всем?»**

Текст: «У предложения „Материалы“ сохранён допуск „Всем“. После включения оно
станет доступно для покупки всем. Чтобы продавать только по приглашению,
отмените действие и сохраните другой допуск».

Действия: **«Отмена»** и **«Включить продажу всем»**. Начальный фокус — на отмене;
после закрытия он возвращается на кнопку тарифа. Escape отменяет действие.
Подтверждение вызывает только демонстрационный callback один раз. Действия не
сохраняют допуск, не включают продажу и не отправляют команды BFF.

## Истории

Общий заголовок: `Proofs/Authoring/Subscription Sale Confirmation`.

- `proofs-authoring-subscription-sale-confirmation--desktop` — открытый диалог, 1440 px.
- `proofs-authoring-subscription-sale-confirmation--mobile` — тот же диалог, 390 px.
- `proofs-authoring-subscription-sale-confirmation--narrow-mobile` — тот же диалог, 320 px.
- `proofs-authoring-subscription-sale-confirmation--interaction` — отмена кнопкой,
  публичное native-событие cancel и однократное подтверждение.

Storybook interaction проверяет демонстрационные callback и видимый результат.
Синтетическое событие cancel не доказывает обработку доверенной клавиши Escape;
настоящие Escape/Tab и возврат фокуса требуют отдельной browser-проверки.

## Подготовка и проверки

Перед реализацией реально прочитаны через локальный Storybook MCP `docs-list`,
`get-storybook-story-instructions`, `docs-show` для Button, Access и Material editor,
а также `docs-show-story` существующего ProductRemovalConfirmation.
Первые запросы docs-show завершились timeout 15 s без ответа; после запуска с
поддерживаемым `STORYBOOK_DISABLE_TELEMETRY=1` получены реальные ответы за
8.88, 7.61 и 8.14 s соответственно. Это результат подготовки, не доказательство
причины первоначальных timeout. Сервер после чтения остановлен, порт 6006 освобождён.

Frozen install завершился exit 0 с закреплёнными Node 26.10.0 и pnpm 11.27.1;
первый запуск с системным Node 24.19.0 завершился exit 1 на проверке версии.
Raw preparation receipts сохранены в игнорируемом
`ci-artifacts/evidence/issue-781/preparation/` собственного worktree.

Desktop/mobile captures, overflow на 320/390/1440, доверенные keyboard checks,
axe, Storybook MCP test-run, final pnpm check и независимое ревью пока **не выполнены**.
Общий runtime-слот принадлежит release blockers; факт выполнения будет записан
после выделенного запуска. Визуального принятия владельцем ещё нет.

## Следующий шаг

После проверок и просмотра снимков координатор предъявляет этот единственный
диалог владельцу. Production-warning по сохранённым eligibility/revision и
обновление `production-release.md` выполняются отдельно после принятия proof.
Этот прототип не завершает #781 и не даёт разрешения на реальные продажи.
