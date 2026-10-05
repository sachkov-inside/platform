# Аудит текущей публикации материалов для Platform v1

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-current-publishing-audit.md); текущие правила — [документы Platform](../../README.md).

Статус: исследовательская рекомендация для owner decision; не ADR и не утверждённая taxonomy.

Дата аудита: 2026-08-21.

Основание: [Workspace issue #39](https://github.com/sachkov-inside/workspace/issues/39), десять
owner-approved скриншотов текущего небольшого каталога и подтверждённое решение пересоздать
материалы в Platform вручную, используя скриншоты только как visual reference [OD1].

## Рекомендация в одном абзаце

Для Platform v1 рекомендуется отделить **Material** как самостоятельную библиотечную единицу от
независимых расширяемых **Topic**, **Format**, **Tag** и опционального упорядоченного членства в
**Series**. Видео, изображения, файлы и внешние ссылки должны быть содержимым или связанными
артефактами Material, а не конкурирующими типами каталога. Конкретные словари и filter UI сейчас
фиксировать рано: модель должна позволять создавать значения по мере ручного наполнения реальным
контентом [OD2]. «Создание Platform Inside» принимается как ordered Series, а текущая таблица
материалов становится generated index; Roadmap остаётся editorial/navigation page [OD3] [S8]
[S9] [S10]. Короткий `Note` и общий community CTA остаются допустимым будущим сценарием, но не
обязательной частью v1 [OD4].

## Граница аудита и способ цитирования

### Подтверждённые решения

- Текущий каталог небольшой; полный Telegram export не нужен, а скриншоты являются достаточным
  входом для bounded audit ([issue #39](https://github.com/sachkov-inside/workspace/issues/39)).
- Видеозаписи и материалы будут **вручную заново созданы** в Platform в удобном целевом виде.
  Скриншоты являются только visual reference для target authoring и catalog structure [OD1].
- Конкретные Topic/Format/Tag dictionaries и filter UI выбираются позже по мере ручного наполнения;
  задача #39 должна проверить достаточность entity model, а не утвердить seed taxonomy [OD2].
- «Создание Platform Inside» принимается как ordered Series; material index генерируется из
  metadata, а Roadmap остаётся editorial/navigation page [OD3].
- Durable `Note` и общий Telegram community CTA допустимы, но не требуются в первой версии [OD4].
- Inside сейчас Telegram-first, а позднее собственное приложение становится домом материалов и
  навигации; Telegram остаётся местом общения и коротких анонсов
  ([`product/README.md`](../product/README.md)).

### Evidence inventory

Скриншоты не добавляются в repository. В документе ссылка вида `[S4]` означает наблюдение на
owner-approved screenshot с этим ID; `[OD1]`–`[OD4]` — явные owner clarifications в рабочей сессии
2026-08-21. Evidence IDs не доказывают то, чего нет в видимой области изображения.

| ID | Что видно и для чего используется |
|---|---|
| S1 | Три video posts с последовательными заголовками «Разработка платформы — 3/4/5», краткими описаниями и hashtags; evidence серии, title/summary и смешанных facets. |
| S2 | Topic «Видеозаписи», несколько video cards с duration, caption, hashtags и ссылкой на Excalidraw; evidence video material и связанного артефакта. |
| S3 | Topic «Посты» с pinned scope и короткими link posts; evidence durable note-кандидатов и external link preview. |
| S4 | Продолжение link post про prompt/security и начало следующего post; evidence длинного note с внешним repository preview. |
| S5 | Короткий post о voice input tool с image, external link и reactions; evidence note, image и engagement, которое не является content metadata. |
| S6 | Topic «Материалы»: отдельный `.excalidraw` file и большой structured text о public agent skills; evidence file attachment и text guide. |
| S7 | `.excalidraw` file для career video и structured guide о landing/design references; evidence cross-topic artifact и rich text structure. |
| S8 | Pinned navigation post и начало illustrated Roadmap; evidence navigation root, mutable orientation content и направления продукта. |
| S9 | Полный вводный navigation post со ссылками на Roadmap, видео, материалы, repositories и support; evidence различия каталога, навигации и общения. |
| S10 | Pinned material index с разделами, numbered links и колонками «Проект»/«Тип»; evidence ручной collection view и текущей классификации. |
| OD1 | Owner clarification: материалы и видео вручную пересоздаются в Platform; screenshots используются только как visual reference. |
| OD2 | Owner clarification: сейчас не нужно утверждать taxonomy; Topic/Format/Tag values выбираются при реальном наполнении, а результат аудита должен определить поддерживающую entity shape. |
| OD3 | Owner decision: platform build — ordered Series; Roadmap — editorial page; material index — generated view. |
| OD4 | Owner clarification: `Note` и общий community CTA возможны, но не обязательны для v1. |

Названия материалов и tool names ниже сохраняются только там, где нужны для классификации и
search acceptance. Имена участников, аватары, размер сообщества, reactions и иные персональные или
операционные детали не переносятся в отчёт [S1]–[S10].

## Подтверждённые наблюдения и интерпретации

| Видимый факт | Подтверждённое наблюдение | Допустимая интерпретация, не owner decision |
|---|---|---|
| Telegram Topics | Navigation, Posts, Videos, Materials и chat spaces показаны как отдельные containers [S2] [S3] [S8]. | Containers одновременно выполняют storage и navigation role; их не следует автоматически превращать в Topics taxonomy. |
| Video unit | Video card может иметь duration, title/caption, description, hashtags и ссылку на browser artifact [S1] [S2]. | Один Material может иметь format `video`, текстовое сопровождение и связанные assets/links. Provider video и Material остаются разными entities согласно выбранной границе lifecycle ([`platform-kinescope-video-lifecycle.md`](platform-kinescope-video-lifecycle.md)). |
| Text unit | В одном Telegram message встречаются headings, paragraphs, bold text, bullets и hyperlinks [S6] [S7]. | Это достаточно для минимального rich-text fixture; точный v1 formatting set всё ещё требует owner approval ([`platform-content-authoring-model.md`](platform-content-authoring-model.md)). |
| Short post | Posts описаны как мысли, которые не разворачиваются в video или отдельный material; examples содержат commentary, link preview и иногда image [S3] [S4] [S5]. | Полезные durable posts могут позже стать `note`; этот сценарий не обязателен для v1 [OD4]. |
| File | Excalidraw files опубликованы отдельными messages и словами связаны с конкретными videos [S6] [S7]. | В Platform это вероятнее `Asset` соответствующего Material, а не отдельный Format или самостоятельный Material. |
| Series | Три video titles имеют один stem и номера 3–5 [S1]. | Это сильный candidate одной ordered Series, но screenshots не доказывают полный состав или отсутствие других episodes. |
| Hashtags | `#video`, `#ai_first`, `#работы_в_it`, `#лендинг`, `#проектирование`, `#harness` стоят в одном поле [S1] [S2]. | Текущий hashtag layer смешивает Format, Topic и Tags; target dictionaries должны развести facets. |
| Index | Pinned material table группирует links и хранит «Проект» и «Тип» [S10]. | Это hand-maintained collection/navigation projection; values «Теория», «Лендинг», «Harness», «Платформа» смешивают classification levels и не должны переноситься одним enum. |
| Roadmap | Pinned navigation post ведёт к illustrated Roadmap с несколькими направлениями [S8] [S9]. | Owner выбрал navigation/editorial page, а не library Material [OD3]. |
| Discussion | Отдельное пространство общения видно рядом с content containers [S2] [S3] [S8]. | Скриншоты не показывают material-specific discussion relation; наличие общего чата не доказывает thread link для каждого Material. |
| Announcement | Navigation copy обещает обновление, а product brief оставляет Telegram роль коротких announcements [S8] [S9] ([`product/README.md`](../product/README.md)). | Ни один screenshot нельзя уверенно классифицировать как самостоятельный announcement конкретного Material. |

Таким образом, screenshots подтверждают **publication shapes**, но не канонические entity
boundaries. В частности, Telegram message boundary не должна становиться Platform Material boundary
автоматически [S2] [S6] [S7]; материалы всё равно создаются вручную [OD1].

## Текущая модель публикации

Текущую видимую модель можно описать как пять связей:

1. **Container → messages.** Telegram Topic задаёт coarse destination: videos, text/files, short
   posts или navigation [S2] [S3] [S6] [S8].
2. **Message/group → content unit.** Caption, body, media card и link preview вместе несут title,
   summary/body и media, но границы различаются от примера к примеру [S1] [S2] [S5].
3. **Hashtag → неявная классификация.** Одно поле смешивает subject, delivery format и narrow
   concepts [S1] [S2].
4. **Pinned message/table → navigation.** Два уровня ручной навигации дают product roadmap и список
   material links; таблица дополнительно хранит current grouping/project/type [S8] [S9] [S10].
5. **Text link → relation.** Videos, source boards, sites и repositories связываются caption или
   hyperlink; formal typed relation на screenshots не видна [S2] [S3] [S6] [S7].

Reactions и Telegram service metadata присутствуют в UI, но не описывают смысл Material и не нужны
для ручного authoring в Platform [S5]. Отдельные discussion spaces являются частью текущего
Telegram-first product, однако shown evidence не связывает их с individual materials [S2] [S3].

## Целевая структура Platform

### Entity boundary

Рекомендуемый, но ещё не утверждённый content/catalog contract уточняет исследовательскую модель
`SearchDocument` с `topicId`, `formatId`, `seriesIds` и `tagIds`
([`platform-content-authoring-model.md`](platform-content-authoring-model.md)):

| Entity | Минимальные поля | Правило |
|---|---|---|
| `Material` | `id`, `title`, `summary`, versioned `body`, `topicId`, `formatId`, `tagIds[]`, `seriesMemberships[]`, `assetRefs[]`, `externalLinks[]`, `relatedMaterialIds[]`, `discussionRef?`, `publishedAt` | Самостоятельная единица library/search/read. Topic и Format — по одному; остальные relations optional. |
| `Series` | `id`, `title`, `summary`, ordered items `{materialId, ordinal}`, `status?` | Editorial sequence, а не subject и не format. Ordinal принадлежит membership, чтобы title не был единственным источником порядка. |
| `Asset` | local `id`, `kind`, `label`, presentation metadata и access scope | Image, downloadable file и video reference не становятся Format. Canonical nodes ссылаются на local Asset/Video IDs ([`platform-content-authoring-model.md`](platform-content-authoring-model.md)). |
| `NavigationCollection` | `id`, `title`, `description`, query или curated `materialIds[]` | «Все материалы», topic page и series page; не добавляет новый Format и не копирует metadata. Roadmap остаётся отдельной editorial page [OD3] [S8] [S9] [S10]. |
| `ExternalDiscussionRef` | provider-neutral locator или application relation, label | Optional relation после отдельного owner decision; screenshot не доказывает связь individual discussion [S2] [S3]. |
| `Announcement` | delivery record/reference на Material, если Platform вообще должен его знать | Не становится Material автоматически; Telegram остаётся announcement surface согласно product brief ([`product/README.md`](../product/README.md)). |

`Material.formatId` описывает **основной способ потребления**. Поэтому career recording остаётся
`video`, хотя в title есть слово «гайд» и рядом лежит Excalidraw file [S2] [S7]. Аналогично text
guide с hyperlinks остаётся `guide`, а не `link` [S6] [S7].

### Иллюстративная классификация показанного контента

Таблица ниже доказывает, что рекомендованная entity shape покрывает sample. Это не seed data и не
утверждённые словари: display values будут выбраны во время ручного authoring [OD1] [OD2].

| Current evidence | Target classification | Relations / notes |
|---|---|---|
| «Разработка платформы — 3/4/5» [S1] | Topic `product-engineering`; Format `video`; Series `inside-platform-build` | Tags по episode: `landing-pages`, `product-discovery`, `harness`; общий Tag `ai-first-workflow` сохраняет cross-cutting AI-first signal без второго primary Topic. |
| «Гайд на поиск работы и резюме в IT» [S2] | Topic `career`; Format `video` | Tags `job-search`, `resume`; `find_job.excalidraw` — related Asset [S7]. |
| «Теоретическая база об агентах и harness» [S2] | Topic `ai-first-engineering`; Format `video` | Tags `ai-agents`, `harness`; `how-agents-works.excalidraw` — related Asset [S6]. |
| «Публичные skills для agent-first setup» [S6] | Topic `ai-first-engineering`; Format `guide` | Tags `agent-skills`, `harness`; headings, paragraphs и links входят в body. |
| «Где искать референсы для лендингов и дизайна» [S7] | Topic `frontend-design`; Format `guide` | Tags `landing-pages`, `design-references`; перечисленные sites остаются external links/body content. |
| Agentation design note [S3] | Topic `frontend-design`; Format `note` | Tags `design-feedback`, `ai-agents`; external link и optional image. |
| Choirboy prompt/security note [S3] [S4] | Topic `ai-first-engineering`; Format `note` | Tag `prompt-security`; repository URL остаётся external link. |
| Handy voice-input note [S4] [S5] | Topic `ai-first-engineering`; Format `note` | Tags `voice-input`, `local-llm`; screenshot image — optional Asset, reactions не переносятся. |
| Roadmap [S8] [S9] | `NavigationCollection`/editorial page | Не `Topic`, не `Format`; может ссылаться на topic and series views. |
| Material index [S10] | Generated/curated `NavigationCollection` | Заменяется catalog query + explicit curation, не хранит дублирующие «Проект»/«Тип». |

Product brief уже различает small posts, structured guides, engineering materials, career content,
artifacts и флагманскую build-series; target mapping сохраняет это различие без превращения
Membership в один линейный курс ([`product/README.md`](../product/README.md)).

## Evidence-derived candidate values без смешения facets

Это **примеры candidate values** только для проверки границ модели на показанном корпусе. Они не
утверждаются как v1 dictionaries и не обязаны заранее создаваться в базе [OD2]. Новые values
появляются вместе с real material, а не из попытки перечислить весь engineering domain
[S1]–[S10]. Stable ID приведён лишь как пример; naming/localization policy выбирается позже.

### Topic — о чём Material

| ID | Display label | Evidence | Boundary |
|---|---|---|---|
| `ai-first-engineering` | AI-first engineering | Agents, harness, skills, prompt/security и voice workflow [S2] [S3] [S5] [S6]. | Не Format и не автоматически Series. |
| `product-engineering` | Product engineering | Platform build, MVP discovery и landing implementation [S1] [S10]. | `landing-pages`, `harness` и `product-discovery` остаются Tags. |
| `frontend-design` | Frontend & design | Landing references и visual feedback tool [S3] [S7]. | Не создавать Topic на каждый tool/site. |
| `career` | Карьера | Job search/resume video и board [S2] [S7] [S10]. | `job-search` и `resume` — более узкие Tags. |

### Format — как Material потребляется

| ID | Display label | Inclusion rule | Evidence |
|---|---|---|---|
| `video` | Видео | Основная единица — recording; caption/body и related files допустимы. | [S1] [S2]. |
| `guide` | Guide | Structured authored text с headings/lists/links; attached files optional. | [S6] [S7]. |
| `note` | Note | Короткая durable observation/recommendation, обычно с external link или image; поддержка допустима, но не обязательна для v1 [OD4]. | [S3] [S4] [S5]. |

`file`, `image`, `link`, `Excalidraw`, `repository` и `video+file` не являются Format values: это
Asset kinds, external-link kinds или combinations внутри одного Material [S2] [S3] [S6] [S7].
`Roadmap` также не Format по умолчанию: это navigation/editorial role [S8] [S9].

### Tag — узкий concept или technology

| ID | Display label | Evidence |
|---|---|---|
| `ai-first-workflow` | AI-first workflow | [S1] [S8]. |
| `ai-agents` | AI agents | [S2] [S3] [S6]. |
| `agent-skills` | Agent skills | [S6] [S10]. |
| `harness` | Harness | [S1] [S2] [S6] [S10]. |
| `landing-pages` | Landing pages | [S1] [S7] [S10]. |
| `design-references` | Design references | [S7]. |
| `design-feedback` | Design feedback | [S3]. |
| `product-discovery` | Product discovery / MVP | [S1]. |
| `job-search` | Job search | [S2] [S7] [S10]. |
| `resume` | Resume / резюме | [S2] [S7] [S10]. |
| `prompt-security` | Prompt security | [S3] [S4]. |
| `voice-input` | Voice input | [S5]. |
| `local-llm` | Local LLM | [S5]. |

Current hashtags map semantically, not mechanically: `#video → Format(video)`, `#работы_в_it →
Topic(career) + Tag(job-search)`, while `#лендинг`, `#проектирование` and `#harness` become narrow
Tags. `#ai_first` maps to Topic `ai-first-engineering` for agent materials and to Tag
`ai-first-workflow` when `product-engineering` is the primary Topic [S1] [S2]. Это manual mapping
для target authoring, а не правило обработки Telegram data [OD1].

### Series — какой ordered editorial line принадлежит Material

| ID | Display label | Status | Evidence / boundary |
|---|---|---|---|
| `inside-platform-build` | Создание Platform Inside | Series role принята; exact ID/title можно уточнить при создании. | Numbered titles 3–5 form a visible sequence [S1]; product brief separately confirms flagship build-series ([`product/README.md`](../product/README.md)). Screenshots не доказывают полный episode list [OD3]. |

`AI First` из material index рекомендуется сделать Topic/collection, не Series: его shown rows
включают теорию, project steps и text skills без единого доказанного ordered narrative [S10].
`Поиск работы и резюме` пока имеет один видимый Material и тоже не требует Series [S2] [S10].

## Навигация и отложенные фильтры

Принятая и рекомендуемая library navigation:

1. **All materials** — search и sort by newest; filters появляются позже из реально используемых
   metadata [OD2].
2. **Topic pages** — появляются вместе с реально созданными Topic values, а не из заранее
   зафиксированной taxonomy [OD2].
3. **Series page** — ordered episodes, progress/status and linked artifacts для «Создания Platform
   Inside» [OD3].
4. **Roadmap/editorial page** — explains directions and links into Topics/Series without duplicating
   the material table [S8] [S9] [S10].

Entity model должна позволять filters ниже, но owner отложил конкретный набор и filter UI до
реального наполнения [OD2]:

| Filter | Values now | Why now |
|---|---|---|
| `Topic` | AI-first engineering, Product engineering, Frontend & design, Карьера | Current corpus already spans these subjects [S1] [S2] [S3] [S7]. Product brief requires direction-based trajectories ([`product/README.md`](../product/README.md)). |
| `Format` | Видео, Guide, Note | Three visibly different consumption modes [S1] [S3] [S6]. |
| `Series` | Создание Platform Inside; «Без серии» optional | Ordered build episodes need a direct path [S1], while most shown content is not proven serial [S2] [S3] [S6] [S7]. |

До этого Platform может начать с All materials, search, newest sort и Series page. Tags могут быть
searchable/visible без отдельной панели. `PublishedAt` — sort, не facet; `Asset kind` не становится
top-level filter без demonstrated need. `Entry level` product-relevant, но отсутствует в
screenshots и остаётся будущим metadata decision
([`product/README.md`](../product/README.md)) [OD2] [S1]–[S10].

## Ограниченный search relevance set

Search projection should index title, summary, headings/body, asset labels, Topic, Format, Series and
Tags as already recommended in
[`platform-content-authoring-model.md`](platform-content-authoring-model.md). For this fixture set,
rank exact/normalized title matches above headings/summary, then taxonomy labels, body and asset
labels. Kinescope transcripts are not required because no reviewed transcript is shown and the
existing model leaves transcript indexing open
([`platform-content-authoring-model.md`](platform-content-authoring-model.md)) [S1] [S2].

Expected results below are a bounded candidate acceptance set for those fixtures that owner решит
вручную пересоздать, not a promise about v1 scope or unseen catalog content [OD1] [OD2] [OD4].
`First` means the named Material should rank above other shown fixtures; `included` means it should
appear without fixed rank.

| Query | Case | Expected result | Evidence |
|---|---|---|---|
| `поиск работы резюме` | RU exact concepts | Career video first; its Excalidraw label contributes but does not produce a second result. | [S2] [S7] [S10]. |
| `агенты harness` | RU + EN term | «Теоретическая база об агентах и harness» first; public skills guide included. | [S2] [S6]. |
| `референсы для лендинга` | RU normalized | Landing/design references guide first. | [S7]. |
| `голосом диктовать промты` | RU body phrase | Handy voice-input note first. | [S5]. |
| `AI agents harness` | EN | Agent/harness theory video first; public skills guide included. | [S2] [S6]. |
| `agent skills` | EN | Public skills guide first; material-index episode about first skills included if recreated. | [S6] [S10]. |
| `design feedback agents` | EN | Agentation note first. | [S3]. |
| `choirboy prompt security` | EN title/link + taxonomy | Choirboy note first. | [S3] [S4]. |
| `лендинк Astro` | Typo + exact technology | Platform-build landing episode first; landing references guide included. | [S1] [S7] [S10]. |
| `harnes агенты` | Typo | Agent/harness theory video first; public skills guide included. | [S2] [S6]. |
| `резюмэ` | Typo | Career video first. | [S2] [S7] [S10]. |
| `postgresql` | Negative shown-corpus case | No shown fixture is required to match. | [S1]–[S10]. |

Typos above require bounded normalization/fuzzy matching, not arbitrary semantic expansion. The
acceptance set also implies RU inflection normalization (`лендинг`/`лендинга`) and case-insensitive
matching, while explicit RU↔EN synonyms should be a small reviewed dictionary attached to current
Topics/Tags (`агенты ↔ agents`, `скиллы ↔ skills`, `резюме ↔ resume`) [S1] [S2] [S6] [S7].

## Зафиксированные owner decisions и оставшаяся граница

Зафиксировано:

1. Telegram content не импортируется: материалы создаются вручную, screenshots служат reference
   [OD1].
2. Конкретные Topic/Format/Tag dictionaries, synonyms и filter UI не фиксируются до реального
   наполнения [OD2]. Candidate values выше проверяют выразительность модели, но не являются seed.
3. «Создание Platform Inside» — ordered Series; Roadmap — editorial/navigation page; material index
   — generated view [OD3].
4. `Note` и общий community CTA могут появиться позже, но не являются обязательным v1 scope [OD4].

Остаётся recommendation, а не owner-approved application schema: `Material` как центр, независимые
расширяемые Topic/Format/Tag, ordered Series memberships и связанные Video/Asset/ExternalLink.
Отдельный Platform specification/ADR должен подтвердить точные cardinality и required fields.
Для первой реализации также можно отложить material-specific discussion relation: screenshots
подтверждают только общее пространство общения [S2] [S3] [S8].

## Ограничения и явно запрещённые выводы

- Десять screenshots — bounded visual sample, а не полный каталог; они не доказывают количество
  материалов, полноту series, chronology или coverage Topic/Format [S1]–[S10].
- Нельзя делать выводы об отсутствии дублей, пропусков, удалённых/скрытых posts или content вне
  видимой области ([issue #39](https://github.com/sachkov-inside/workspace/issues/39)) [S1]–[S10].
- Полный импорт, доказательство отсутствия дублей/пропусков и оценка переноса не входят в решение.
  Platform content создаётся вручную [OD1]
  ([issue #39](https://github.com/sachkov-inside/workspace/issues/39)).
- Link previews, reactions, edits, pins и topic placement показывают Telegram presentation, но не
  обязывают Platform копировать его UI или service metadata [S3] [S5] [S8] [S10].
- Candidate dictionaries не являются global ontology Inside. Product допускает несколько
  trajectories и живое появление новых тем, поэтому taxonomy расширяется только на основе
  опубликованного content и owner decision ([`product/README.md`](../product/README.md)).
- Versioned ProseMirror JSON + Tiptap и приведённый SearchDocument остаются исследовательской
  рекомендацией до owner decision/ADR; этот аудит уточняет fixtures и metadata, но не повышает их
  статус ([`platform-content-authoring-model.md`](platform-content-authoring-model.md)).

После owner decisions durable application-specific schema и ADR должны жить в owning Platform
repository, а этот Workspace report остаётся shared product research
([`docs/agents/domain.md`](../agents/domain.md)).
