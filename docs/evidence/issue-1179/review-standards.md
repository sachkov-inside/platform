## Standards — итоговый проход

Reviewed head: `06b42f5e3d15fb208275e66e3a47ea4f15df6b70`. Fixed point: `bee563b26de0b2a863287ee5df95c8e66aec22b1`. Проверен собственный итоговый diff #1179 относительно `e47908668aed832be10b1d92d8e8912d5684e348`; merged интеграции отдельно не переоценивались.

### Нарушения документированных правил

- **P3 — обновлённый комментарий неверно называет порог прокрутки.** `apps/web/src/storybook/story-environment.tsx:157` утверждает, что оболочка прокручивается начиная с `48rem`. Правило: корневой `CODING_STANDARDS.md:173`, «Text that describes the system»: утверждение должно совпадать с владельцем факта на reviewed head. Владелец — `apps/web/src/widgets/application-shell/ui/application-shell.client.tsx:111`: контейнер получает `overflow-y-auto` только на `lg`. `apps/web/app/globals.css:293` и `:302` разделяют режимы на `64rem`; актуальный `docs/agents/frontend-delivery.md` тоже называет `lg`. Сценарий: при проверке story шириной 800 px рецензент ожидает прокрутку контейнера, хотя прокручивается документ, и выбирает неверную опору для геометрии. Исправить комментарий на `64rem`; согласовать также сохранившуюся формулировку `48rem` в `apps/web/CODING_STANDARDS.md:33`. Поведение приложения менять не требуется.

### Возможные code smells

Новых подтверждённых smells не найдено. Первое замечание об обходах закрыто объяснением: оглавление намеренно фильтрует блоки иначе, чем распределение исходных якорей. Расширение оглавления не требую.

Первое нарушение размещения исправлено: `BodyFragmentNavigation` находится в `shared/ui`, используется через общий `MaterialBodyView` в Reader и Task c и не зависит от `#content`. Проверены приоритет исходного якоря, перенос ID оболочки и связность Task nav/aria адресов. Утверждения об импортируемых fragments сверены с `local-sync.mjs` и `task-page.mjs`; алгоритм — с `heading_records` на указанном Content commit. Измерения desktop/mobile подтверждаются `integrated-fullstack-root-relative.log`.

Проверки, серверы и установка не запускались. Final `pnpm check` и CI не объявляются зелёными. Worktree обновлён разрешённым fast-forward; локальных tracked-правок нет.

Итог: 1 нарушение P3; новых smells — 0.

## Outcome

P3 fixed after this review: the Storybook wrapper comment and Web coding standard now name 64rem, matching the application shell.
