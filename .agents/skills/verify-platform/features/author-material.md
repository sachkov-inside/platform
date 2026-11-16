# Author a material

The owner writes a material in the admin editor, sets its parameters and publishes it. A published
free material opens at its address and, with the feed flag, appears first in the home feed.

## Sub-features

- `author-draft` creates a draft that saves itself.
- `author-required` refuses to publish without a topic and a format.
- `author-publish` publishes the material.
- `author-visible` shows the material to readers at its address and in the home feed.

## How to get to it (user POV)

- «Материалы» in the admin navigation (`/authoring/materials`), then «Новый материал»:
  `O find role link click --name "Материалы" --exact`, `O find role link click --name "Новый материал"`.
- The direct address `/authoring/materials/new`.
- An existing row in `/authoring/materials`, to edit *(not yet driven)*.

## Driving it with agent-browser

Preconditions: the baseline; no material is titled «Проверка verify-platform». Set the owner
session to 1440×900 right after its first `open`.

- **Open the editor.** `O open "$(V address owner /authoring/materials/new)"`,
  `O wait --text "Параметры материала"`. The heading is «Новый материал»; «Предпросмотр» and
  «Опубликовать» are disabled; the tab «Параметры» is selected.
- **Draft (`author-draft`).** `O find label "Название" fill "Проверка verify-platform"`,
  `O find label "Краткое описание" fill "Материал создан проверяющим агентом."`,
  `O find role tab click --name "Содержимое"`, `O find role textbox click --name "Содержимое материала"`,
  `O keyboard type "Текст проверки verify-platform."`, `O wait --text "Сохранено"`. The address
  becomes `/authoring/materials/<id>?from=…`, the status starts with «Черновик» and
  «Опубликовать» is enabled.
- **Required parameters (`author-required`).** `O find role button click --name "Опубликовать" --exact`.
  An alert reads «Не удалось опубликовать. Проверьте отмеченные поля.» with «Назначьте формат перед
  публикацией.» and «Назначьте тему перед публикацией.»
- **Parameters.** `O find role tab click --name "Параметры"`; `O find role combobox click --name "Тема"`,
  `O wait '[role=listbox]'`, `O find role option click --name "Платформа"`,
  `O wait --fn "!document.querySelector('[role=listbox]')"`; the same for «Формат» with the option
  «Заметка»; `O find label "Показывать в ленте на главной" check`; `O wait --text "Сохранено"`. The alert
  from the refused attempt stays on screen until the next publish.
- **Publish (`author-publish`).** `O find role button click --name "Опубликовать" --exact`,
  `O wait --text "Снять с публикации"`. The publish button is now «Снять с публикации» and the
  status starts with «Опубликован».
- **Readers (`author-visible`).** `G open "$(V address web /materials/proverka-verify-platform)"`,
  `G wait --text "Текст проверки verify-platform."`; then `G open "$(V address web /)"`: the first
  link in the region «Материалы» is «Проверка verify-platform».
- **Side effects.**
  `V sql "select slug, access, in_feed from materials.published_materials where title = 'Проверка verify-platform'"`
  returns `proverka-verify-platform,free,t`.

## Gotchas

- Each list stays open until its option is chosen and closes after; wait for the listbox to
  disappear before opening the next, or the second `combobox` is not found.
- In a short window the editor's «На весь экран» control covers «Опубликовать» and the click is
  refused as covered. Keep 1440×900 and scroll to the top.
- The words after «Черновик ·» and «Опубликован ·» are a save indicator («Сохранено сейчас»,
  «Не сохранено», «Без изменений») that changes within seconds; do not assert on them.
- The slug is the transliterated title; a second material with the same title gets another slug.
- Cover, video, link card and the «Доступ» choice are not covered by this recipe. Video upload
  needs the provider and runs in test mode on a light instance.
- Publication announcements are queued for workers that a light instance does not run.
