# Оформление редактора воронок — #316

Визуальная приёмка [Platform #316](https://github.com/sachkov-inside/platform/issues/316).
Подготовлено 6 сентября 2026 года от `e528cbe` (функциональная часть #308).
В рабочую ветку включён принятый `2980d46` (#309); ссылка «Рассылки и аналитика» сохранена.

Редактор использует общие tokens из `app/globals.css` и принятый `AuthoringShell`.
Storybook и `/authoring/communications` импортируют один `CommunicationsWorkspace`.
Выбранная воронка выделена в списке; настройки, сообщения, источники, проверка охвата и история
разделены на блоки. Длинные подписи действий переносятся на узком экране. Сохранены отдельные
Save, Preview, Publish и явное подтверждение риска дубля перед retry.

## Что смотреть

Локально: `pnpm --filter @inside/web exec storybook dev -p 6316 --ci`.
Каталог: **Pages → Authoring → Воронки Telegram**. Agentation включён для ручных замечаний.
Состояния: Existing, Empty, Loading, NoAccess, Conflict, PublishPreview, UnpublishedTarget,
MultipartMobile, UnknownDelivery, LoadError, Keyboard, NarrowMobile, Dark.
Storybook fixtures не отправляют сообщения; кнопки предназначены для проверки интерфейса.

| Состояние Storybook | Desktop | Mobile |
| --- | --- | --- |
| Редактор | [1440](story-existing-1440.png) | [390](story-existing-390.png) |
| Пустой список | [1440](story-empty-1440.png) | [390](story-empty-390.png) |
| Загрузка | [1440](story-loading-1440.png) | [390](story-loading-390.png) |
| Ошибка загрузки | [1440](story-load-error-1440.png) | [390](story-load-error-390.png) |
| Конфликт | [1440](story-conflict-1440.png) | [390](story-conflict-390.png) |
| Охват перед публикацией | [1440](story-publish-preview-1440.png) | [390](story-publish-preview-390.png) |
| Неизвестный результат доставки | [1440](story-unknown-delivery-1440.png) | [390](story-unknown-delivery-390.png) |
| Несколько частей шага | [1440](story-multipart-mobile-1440.png) | [390](story-multipart-mobile-390.png) |
| Клавиатура | [1440](story-keyboard-1440.png) | [390](story-keyboard-390.png) |

## Реальный маршрут

[Desktop](live-1440-top.png), [mobile](live-390-top.png), фокус клавиатуры на
[1440](live-1440-keyboard.png), [390](live-390-keyboard.png) и [320](live-320-keyboard.png),
проверка перед публикацией на [1440](live-1440-preview.png) и [390](live-390-preview.png).

`apps/web/test/e2e/communications.spec.ts` запускает настоящий Next route и browser adapter,
подменяя только ответы BFF синтетическими fixtures. Тест проверяет 320/390/1036/1440 px,
переход Tab к переключателю стандартной воронки, отсутствие переполнения элементов формы,
axe и доступность публикации после Preview. Снимки сохраняются в `ci-artifacts/316`.
Это визуальная проверка страницы, а не новый end-to-end результат backend/provider.

```bash
PLAYWRIGHT_PORT=3316 pnpm --filter @inside/web exec playwright test communications.spec.ts
pnpm test:storybook
pnpm build:storybook
PLAYWRIGHT_PORT=3416 pnpm check
```

## Проверки и решение владельца

- Focused Storybook: 13 состояний прошли.
- Storybook responsive capture: 18 сценариев (9 состояний × 2 ширины), axe и отсутствие overflow.
- Реальная страница: два browser tests, по две ширины в каждом, прошли.
- Standards и Spec review от `e528cbe`: без блокирующих замечаний; найденное отличие активного
  пункта Storybook исправлено в fixture маршрута.
- Итоговый результат полного `pnpm check` и CI для точного head фиксируется в
  [PR #322](https://github.com/sachkov-inside/platform/pull/322).
  Первый общий прогон встретил timeout неизменённого mobile Profile test; его отдельный повтор прошёл.

**Owner visual GO ожидается.** Замечания владельца ещё не получены; их закрытие не заявляется.
Temporary marker #308/#316 намеренно сохранён до принятия внешнего вида. После visual GO
нужно удалить marker, закрыть каждое замечание либо связать его с follow-up, затем отдельно получить
merge GO. Этот документ не закрывает задачу и не подтверждает публикацию.

Не проверены заново: реальные backend/Telegram provider операции, настоящие отправки Telegram,
production deployment. Полная функциональная проверка предшествующей реализации описана в
[историческом evidence #308](../issue-308/README.md); она не выдаётся за прогон текущей ветки.
