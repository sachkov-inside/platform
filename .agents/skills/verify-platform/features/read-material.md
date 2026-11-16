# Read a material

A reader opens a material from the home feed and reads it. A signed-in reader saves it to
bookmarks and marks it read; a closed material shows a paywall to anyone without its product.

## Sub-features

- `read-open` opens a free material from the home feed.
- `read-bookmark` saves the material and lists it on `/bookmarks`.
- `read-mark` marks the material read.
- `read-closed` shows the paywall in place of a closed material's body.
- `read-guest` lets a guest read a free material.
- `read-holder` shows a closed material's body to a person who holds its product.

## How to get to it (user POV)

- A link in the home feed at `/`.
- A direct address `/materials/<slug>`.
- A product's programme: `L open "$(V address web /products/platform-inside)"`,
  `L find role link click --name "Открыть программу"`, `L wait --text "Как устроен Inside Platform"`,
  then a programme link. «Developer Pipeline без потери контекста» shows the paywall. «Как устроен
  Inside Platform» shows the gate «Бесплатный урок» with «Подключить Telegram» to the seeded
  learner (`L wait --text "Бесплатный урок"`), because the learner has no Telegram.
- «Закладки» in the main navigation, for saved materials.

## Driving it with agent-browser

Preconditions: the baseline; the learner has no bookmarks and no read marks.

- **Open from home (`read-open`).** `L open "$(V address learner /)"`, then
  `L find role link click --name "Проверяемая поставка"` and `L wait --text "Конец урока"`. The
  address is `/materials/proveryaemaya-postavka?from=%2F`, the heading is «Проверяемая поставка»,
  and the status reads «Нажмите, чтобы сохранить материал в закладки.»
- **Bookmark (`read-bookmark`).** `L click 'nav[aria-label="Действия материала"] button[aria-pressed]'`
  (the first pressed-state button is the bookmark). The button becomes «Сохранено» with
  «Материал в закладках. Нажмите, чтобы убрать.» Second view: `L open "$(V address web /bookmarks)"`,
  `L wait --text "Проверяемая поставка"`.
- **Mark read (`read-mark`).** Back on the material (`L find role link click --name "Проверяемая поставка"`
  from `/bookmarks`), `L find role button click --name "Прочитано"`,
  `L wait --text "Отметка сохранена"`. The status reads «Отметка сохранена. Нажмите, чтобы снять её.»
  Second view: `L reload`; the status still reads so. The button keeps its name.
- **Side effects.**
  `V sql "select m.slug from bookmarks.bookmarked_materials b join materials.published_materials m using (material_id)"`
  returns `proveryaemaya-postavka`;
  `V sql "select m.slug, s.is_read from reading_activity.material_states s join materials.published_materials m using (material_id)"`
  returns `proveryaemaya-postavka,t`.
- **Closed material (`read-closed`).** `L open "$(V address web /materials/developer-pipeline-bez-poteri-konteksta)"`,
  `L wait --text "Продолжение для участников"`. The region shows «Этот материал доступен участникам
  курса.» and the link «Приобрести курс»; the buttons «Сохранить, закладка недоступна» and
  «Изучено» are disabled; the text «Закрытое содержимое для участников.» is absent.
- **Holder (`read-holder`).** `H open "$(V address holder /materials/developer-pipeline-bez-poteri-konteksta)"`,
  `H wait --text "Закрытое содержимое для участников."` The paywall region is absent and
  «Изучено» is enabled.
- **Guest (`read-guest`).** `G open "$(V address web /materials/proveryaemaya-postavka)"`,
  `G wait --text "Конец урока"`. The body is readable without sign-in.

## Gotchas

- The read mark is named by format: «Прочитано» on a note, «Изучено» on a guide. Take the name
  from a snapshot of `nav[aria-label="Действия материала"]`.
- The action buttons exist twice, at the top and in «Действия в конце материала». `find role`
  acts on the first; scope by the navigation when the second matters.
- A material renders «Загружаем опубликованный материал» first; wait for the heading or
  «Конец урока» before reading the page.
- The cookie notice overlays the bottom of the page and makes clicks there fail as covered until
  «Понятно» is pressed.
- After going back, the programme address carries a query (`?atPlacement=…`); wait for text,
  not for `**/programme`.
- Video playback is not covered: the light instance runs the video provider in test mode.
