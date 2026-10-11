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

Preview URLs из Storybook MCP (сервер после проверки остановлен):

- http://localhost:6006/?path=/story/proofs-authoring-subscription-sale-confirmation--desktop
- http://localhost:6006/?path=/story/proofs-authoring-subscription-sale-confirmation--mobile
- http://localhost:6006/?path=/story/proofs-authoring-subscription-sale-confirmation--narrow-mobile
- http://localhost:6006/?path=/story/proofs-authoring-subscription-sale-confirmation--interaction

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

Проверка браузером на UI head
`45d0505b6788c4a330d768a33652bb4ea4d57542` завершилась **exit 0**.
Локальный Storybook MCP `test-run` с `a11y: true` подтвердил все четыре истории.
Снимки получены через `screenshotWholePage` и лично просмотрены:

| Окно | Снимок | Горизонтальная прокрутка | axe |
| --- | --- | --- | --- |
| 1440 × 1024 | [Desktop](confirmation-1440.png) | нет у страницы и диалога | 0 нарушений |
| 390 × 844 | [Mobile](confirmation-390.png) | нет у страницы и диалога | 0 нарушений |
| 320 × 568 | [Narrow mobile, вся страница](confirmation-320.png) | нет у страницы и диалога | 0 нарушений |

Дополнительный bounded capture на том же UI head завершился **exit 0**.
Для решения о самом диалоге получены и лично просмотрены снимки исходного окна:
[390 × 844](confirmation-390-viewport.png) и
[320 × 568](confirmation-320-viewport.png).
Ledger [viewport-facts.json](viewport-facts.json) подтверждает, что диалог полностью
помещается в окне: на 320 px top 73 / bottom 495, на 390 px top 223 / bottom 621.
Горизонтальной прокрутки и ошибок страницы нет, начальный фокус — «Отмена».

Снимок всей страницы на 320 px имеет высоту 888 px и включает фон вне исходного
окна 568 px. Supplementary ledger фиксирует scrollY 318; native backdrop покрывает
видимое окно. Поэтому offscreen фон в full-page снимке не заменяет снимок самого
окна для визуального решения. Исходный full-page снимок сохранён без изменений.
Это граница метода capture, а не доказательство ошибки native dialog.

Доверенные клавиши браузера подтвердили начальный фокус на «Отмена», Tab к
подтверждению и Shift+Tab обратно. Escape и кнопка отмены закрывают диалог и
возвращают фокус на включение продажи; явное подтверждение тоже возвращает фокус.
Storybook interaction подтверждает однократный демонстрационный callback.
После действий предложение остаётся «Не продаётся», ошибок страницы нет.
Подробные факты с точным UI head: [browser-facts.json](browser-facts.json).

Первый browser-прогон на `107ed755` завершился **exit 1**: проверка ошибочно
требовала, чтобы второй прямой Tab из native dialog возвращался к «Отмена».
Сохранённый ledger показывает `document.hasFocus() === false`, `activeElement`
равен BODY: фокус покинул документ, а не перешёл на фоновый элемент управления.
Исправлена только граница harness: в фокусе должен оставаться элемент диалога
либо документ должен потерять фокус. Перед доверенным Escape отмена фокусируется
явно; круговой Tab этим не объявлен проверенным. Собственный focus trap не добавлен.
Оба actual exit и raw MCP/axe/focus receipts сохранены в игнорируемом
`ci-artifacts/evidence/issue-781/`: `capture-run-1.*`, `validation-run-1/`,
`capture-run-2.*`, `validation/`, `viewport-capture-run-1.*`, `viewport-validation/`.
Owned container/browser/Storybook обоих успешных прогонов полностью удалены,
порт 6006 свободен. Worktree и ветка сохранены для открытого draft PR.

`pnpm docs:check` и `git diff --check` завершились exit 0.
Final `pnpm check` пока **не выполнен**. Макет и текст exact proof `93cd8521` приняты владельцем; это не подтверждает полный check или production visual GO.

Независимое source review исходного `95b95072` нашло один Spec P2: в некоторых
браузерах click не фокусирует кнопку, поэтому сохранение `activeElement` не
гарантировало возврат на кнопку продажи. В `55b68b533b9649fe10863ddf08e986fbcda53f48`
proof-local capture сохраняет саму активированную кнопку. История проверяет native
click, пока фокус остаётся на select. Повторные Standards и Spec review этого
committed head: по 0 оставшихся или новых замечаний. После удаления пояснений
для разработчика из фона повторные независимые review UI head `45d0505b` также
дали по 0 замечаний. Это source review, не решение владельца.

## Принятие и исправление CI

Владелец принял макет и текст exact proof
`93cd8521c76cf976a3548e4569d3aca871256851`: «Принять макет и текст (рекомендуется)».
[Решение в #781](https://github.com/sachkov-inside/platform/issues/781#issuecomment-6109488351)
и [receipt PR](https://github.com/sachkov-inside/platform/pull/1348#issuecomment-6109488506)
разрешают отдельный перенос показанного UI. Production visual GO остаётся отдельным решением.

CI [38142512095](https://github.com/sachkov-inside/platform/actions/runs/38142512095)
на этом proof завершился отказом в четырёх jobs. Все первичные причины — ошибки
двух собственных файлов proof: Static и Telegram остановились на lint, Web E2E
и Production Compose — на TypeScript Next build. Provider/чужой неизменённый тест
не признан причиной; повторный CI не запрашивался.

Исправлены чтение ref во время render (кнопка теперь хранится в React state), пустой
демонстрационный callback, нормализация optional payment mode и ожидание assertions
в Storybook. Single-confirm проверяется парой «один вызов» + «нужный аргумент» вместо
неподдерживаемого typed matcher. Принятые текст, CSS-классы и композиция сохранены.

Raw логи всех четырёх jobs и классификация находятся в игнорируемом
`ci-artifacts/evidence/issue-781/ci-38142512095/`; прежние capture failures сохранены.
Снимки и runtime PASS выше относятся к прежнему UI head `45d0505b` и evidence
`93cd8521`. Они не объявляются проверкой исправленного source head: новые
Storybook/browser проверки и полный `pnpm check` ожидают отдельного runtime-слота.

## Следующий шаг

Принятый диалог переносит отдельный production-исполнитель после собственного
Storybook MCP preflight и выделенного runtime-слота. Production-warning по сохранённым eligibility/revision и
обновление `production-release.md` выполняются отдельно после принятия proof.
Этот прототип не завершает #781 и не даёт разрешения на реальные продажи.
