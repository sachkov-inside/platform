# Каноническая модель авторинга и рендеринга Platform v1

> Историческое исследование на указанную в документе дату. Оно не задаёт текущие правила.
> Источник: [Workspace](https://github.com/sachkov-inside/workspace/blob/125cbde1631a0c9c314a29c829961ab8aa785a06/docs/research/platform-content-authoring-model.md); текущие правила — [документы Platform](../../README.md).

Статус: исследовательская рекомендация для owner decision и последующего ADR.

Дата проверки источников: 2026-08-21.

Основание: [Workspace issue #32](https://github.com/sachkov-inside/workspace/issues/32) и
Platform [`platform-mvp-brief.md`](https://github.com/sachkov-inside/platform/blob/main/docs/product/platform-mvp-brief.md)

## Решение в одном абзаце

Для v1 рекомендуется хранить тело материала как **application-owned, versioned ProseMirror JSON
document**, редактировать его через **Tiptap**, а изображения, файлы и Kinescope-видео представлять
типизированными nodes, которые ссылаются на отдельные platform entities по стабильным ID. Это не
«сохранить весь Tiptap state»: selection, focus, undo history, plugin state и будущий collaborative
state остаются временным состоянием клиента. Канон — только прошедший server-side validation
document snapshot с `schemaVersion` и стабильными `nodeId`. HTML/React tree, plain text для поиска
и Markdown являются производными представлениями. Все изменения из админки, MCP и импортёров идут
через один command API, создают immutable revision и используют optimistic concurrency.

Такой выбор намеренно связывает v1 document format с хорошо определённой ProseMirror-моделью, но
не с UI-компонентами Tiptap. ProseMirror разделяет document model, editor state, view и transforms;
его schema задаёт допустимые nodes, nesting и attributes, а document имеет JSON serialization и
обратный `nodeFromJSON` ([ProseMirror Guide](https://prosemirror.net/docs/guide/)). Tiptap умеет
сохранять этот JSON и statically render его без browser/editor instance
([persistence](https://tiptap.dev/docs/editor/core-concepts/persistence),
[JSON/HTML output](https://tiptap.dev/docs/guides/output-json-html),
[Static Renderer](https://tiptap.dev/docs/editor/api/utilities/static-renderer)). Это даёт один
структурный формат для админки и backend, не превращая HTML или editor runtime в domain authority.

## Почему это соответствует Platform v1

Подтверждённая граница продукта требует собственного author admin, MCP через тот же application
API, draft/preview/publish, импорта Telegram/Obsidian/files, текста и guides, Kinescope, изображений
и скачиваемых файлов. В v1 автор один; editor roles, review chains, real-time collaboration и UGC
явно не нужны. Поэтому решение оптимизируется для:

1. хорошего rich-authoring UX сейчас;
2. строгого server-side контракта для admin, MCP и batch import;
3. безопасного server rendering закрытого контента;
4. обратимых revisions и управляемых schema migrations;
5. сохранения возможности заменить editor adapter позднее.

Оно не оптимизируется под git-first publishing, произвольный page builder, совместное
редактирование нескольких авторов или переносимость в любой CMS без миграции.

## Пять разных представлений

| Слой | Authority | Что содержит | Чего не содержит |
|---|---|---|---|
| Canonical storage | Platform application/database | Versioned ProseMirror document JSON, `schemaVersion`, stable `nodeId`, references на `Asset`/`Video`; immutable revision metadata | HTML, signed URLs, editor selection/history, search index |
| Editor state | Browser admin | Canonical `doc` плюс selection, focus, commands, undo stack, dirty/autosave state и plugin state | Не является API/storage contract |
| Render model | Server renderer | Валидированный canonical tree, преобразованный allowlisted node-by-node в React/HTML; access-aware asset/video URLs | Не принимает сохранённый HTML и не исполняет MDX/JS |
| Import/export contracts | Boundary adapters | Markdown/Obsidian, Telegram export, uploaded file и будущие форматы → import result + warnings → canonical commands; Markdown export — convenience copy | Ни один входной формат не остаётся authority после создания draft |
| Search projection | Projection/index | Plain text, headings, captions/alt, code при выбранной политике, topic/format/series/tags/access scope, revision ID | Canonical document и закрытый body не выдаются публичному search client |

Важно: render AST может технически быть ProseMirror `Node`, React element tree или HAST — это
implementation detail renderer. Его не надо сохранять. Search text также перестраивается из
revision, поэтому смена search engine не мигрирует канон.

## Предлагаемый v1 schema boundary

Schema должна жить в application-owned package/module вроде `content-schema`, независимо от
React admin. Он экспортирует JSON/TypeScript types, runtime validation, ProseMirror/Tiptap
extensions, normalizers, migrations, render mappings, text extraction и fixture corpus.

```ts
type ContentDocument = {
  schemaVersion: 1
  doc: {
    type: 'doc'
    content: ContentNode[]
  }
}

type ContentRevision = {
  id: RevisionId
  contentId: ContentId
  parentRevisionId: RevisionId | null
  baseRevisionId: RevisionId | null
  document: ContentDocument
  metadataSnapshot: PublishableMetadata
  createdAt: Instant
  createdBy: { kind: 'author' | 'agent' | 'import' | 'migration'; id: string }
  source?: ImportProvenance
}
```

`schemaVersion` — версия **нашей** content schema, а не версия npm package. Сохранять её лучше
рядом с `doc`, а не пытаться вывести из отдельных node types. `ContentRevision` должен быть полным
publishable snapshot, включая metadata, series membership и asset references: Contentful отдельно
предупреждает, что snapshot entry не snapshot-ит linked entities, из-за чего восстановленная
ссылка может вести на уже удалённый asset
([Contentful versioning](https://www.contentful.com/help/faq/versioning/)). Поэтому referenced
binary нельзя hard-delete, пока на него ссылается сохранённая revision, либо deletion должна быть
явной irreversible retention operation.

### Минимальная document schema

| Группа | Nodes/marks v1 | Правила |
|---|---|---|
| Текст | `paragraph`, `heading`, `text`, `hardBreak`, `blockquote`, `horizontalRule` | Один `h1` остаётся title материала вне body; в body разрешить только согласованные heading levels |
| Inline | `bold`, `italic`, `strike`, `inlineCode`, `link` | `link` хранит нормализованный `href`; разрешённые schemes задаёт backend |
| Списки | `bulletList`, `orderedList`, `listItem` | Nesting ограничивается schema и size/depth limits |
| Инженерный контент | `codeBlock {nodeId, language}`, `table`, `tableRow`, `tableHeader`, `tableCell` | Code хранится plain text, language — allowlisted identifier; таблицы не допускают произвольный HTML |
| Выделение | `callout {nodeId, tone, title?}` с block content | `tone` — закрытый enum (`info`, `warning`, `success`, `danger`), не CSS class |
| Медиа | `image {nodeId, assetId, alt, caption?}`, `fileAttachment {nodeId, assetId, label}`, `kinescopeVideo {nodeId, videoId, caption?}` | Только platform IDs/provider ID; никогда не iframe HTML, bearer token, storage key или expiring URL |

Tiptap имеет open-source table и code-block extensions, custom node API и отдельные editor node
views ([Table](https://tiptap.dev/docs/editor/extensions/nodes/table),
[CodeBlockLowlight](https://tiptap.dev/docs/editor/extensions/nodes/code-block-lowlight),
[custom nodes](https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/node)). Node
view отвечает за authoring UX, а public renderer — отдельная mapping function; Tiptap прямо
отделяет сложный editor node view от output rendering
([Node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views)).

Все addressable block nodes получают UUID `nodeId`. Tiptap UniqueID поддерживает IDs при split,
merge, paste и undo/redo и умеет добавлять их server-side
([UniqueID](https://tiptap.dev/docs/editor/extensions/functionality/uniqueid)). Text nodes не
нуждаются в собственных IDs: агент адресует text range внутри ближайшего block node и передаёт
precondition.

### Не включать в v1 schema

- raw HTML, `<iframe>`, `<script>`, arbitrary CSS/style и MDX/JS expressions;
- generic `embed {url}` — вместо него provider-specific `kinescopeVideo`;
- base64/blobs внутри document JSON;
- layout columns, buttons, forms и произвольные marketing blocks;
- comments, tracked changes, presence и CRDT state;
- внешний URL как identity изображения или downloadable file.

## Запись, preview и публикация

```text
Admin/Tiptap ─┐
MCP commands ─┼─> Application command API ─> normalize IDs ─> validate
Importers ────┘                                  │
                                                 ├─> immutable revision
                                                 ├─> draft pointer
                                                 ├─> render/search projections
                                                 └─> validation report

Authenticated preview ─> exact revision ─> same renderer ─> access-aware assets/video
Owner GO + publish cmd ─> final validation ─> atomic published pointer change ─> reindex/cache bust
Public/member read ─────> published revision only ─> same renderer
```

1. Client отправляет command с `contentId`, `baseRevisionId` и intent, а не пишет JSON column.
2. Backend применяет command к текущему base, нормализует IDs, проверяет envelope/runtime limits,
   создаёт ProseMirror node из JSON, выполняет schema check и domain validation references.
   Client-side Tiptap check здесь недостаточен: его schema/content checking настраивается отдельно,
   а server обязан fail-closed тем же набором extensions
   ([Tiptap content validation](https://tiptap.dev/docs/editor/core-concepts/schema)).
3. Успех создаёт новую immutable revision и передвигает draft pointer. Конфликт base возвращает
   `409` и текущий revision, не выполняя last-write-wins. Это тот же optimistic-lock pattern,
   который используют Sanity через revision ID и Contentful через version header
   ([Sanity transactions](https://www.sanity.io/docs/content-lake/transactions),
   [Contentful CMA](https://www.contentful.com/developers/docs/references/content-management-api/overview/)).
4. Preview принимает explicit revision ID и доступен только авторизованному author. Он использует
   тот же renderer и asset authorization, что published read path.
5. Publish — отдельная command после owner GO. Она повторяет validation, атомарно меняет
   `publishedRevisionId`, строит search projection и инвалидирует cache. Draft продолжает жить
   независимо.

Не нужно сохранять каждое нажатие клавиши как domain revision. Autosave может debounce-ить
логические snapshots; publish и explicit restore всегда создают отдельные revisions. Точные
retention/cadence — implementation policy, но опубликованные snapshots должны сохраняться.

## Admin authoring UX

Tiptap выбран не только из-за формата. Для одного автора v1 можно собрать focused editor без
page-builder complexity:

- fixed/selection toolbar для inline formatting и slash/insert menu для blocks;
- drag/reorder для atomic media/callout blocks, но обычный continuous text editing для текста;
- image/file picker с upload progress, alt/label и явным статусом обработки;
- Kinescope picker по `videoId` или trusted URL parser с server lookup и preview, без поля iframe;
- code block с language picker и copy preview; table controls; callout tone/title;
- autosave state, last saved revision, validation panel и явные Preview/Publish actions;
- revision compare/restore на уровне block/text diff; import preview с warnings до создания draft.

FileHandler и Image extension сами не загружают файлы на server — они только ловят drop/paste и
показывают image, поэтому upload lifecycle всё равно должен принадлежать application API
([FileHandler](https://tiptap.dev/docs/editor/extensions/functionality/filehandler),
[Image](https://tiptap.dev/docs/editor/extensions/nodes/image)). Это полезная граница: editor
никогда не превращает временный local/blob URL в canonical `assetId`.

## Assets, Kinescope и закрытый доступ

### Images и downloadable files

`Asset` — отдельная entity как минимум с `id`, immutable `storageKey`, `kind`, detected MIME,
byte size, checksum, original filename, image dimensions, processing/status и access scope.
Document node хранит только `assetId` и presentation metadata (`alt`, `caption`, `label`).

Upload flow:

1. Admin/MCP запрашивает upload intent у application API; API авторизует actor, проверяет declared
   type/size и создаёт pending `Asset`.
2. API выдаёт short-lived upload URL на новый случайный object key. Presigned upload позволяет
   загрузить объект без выдачи storage credentials; AWS отдельно отмечает, что существующий key
   будет перезаписан, поэтому key нельзя строить только из имени файла
   ([S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html)).
3. Finalize проверяет фактический size, MIME/signature, checksum и image metadata; для допустимых
   типов выполняется malware/security policy. Только `ready` asset можно прикрепить и публиковать.
4. Public asset может получать cacheable public delivery URL. Member-only asset остаётся private;
   read/download endpoint сначала проверяет material access, затем отдаёт короткий signed GET или
   stream/redirect. Presigned URL является bearer capability до expiration
   ([AWS download docs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/download-objects.html)),
   поэтому его нельзя сохранять в document/search, логировать без redaction или отдавать до auth.

Downloads должны получать безопасный `Content-Disposition`, `X-Content-Type-Options: nosniff` и
allowlisted MIME. Закрытые images требуют такого же access check, как files: спрятать только page
HTML недостаточно. Для images finalize создаёт/регистрирует responsive renditions; renderer выдаёт
intrinsic `width`/`height`, `srcset`/`sizes` и требует осмысленный `alt` либо явно пустой `alt` для
decorative image. Canonical node при этом по-прежнему не знает CDN URLs.

### Kinescope

Canonical node хранит `videoId`, не `embed_link`, HTML или access token. Backend сверяет video через
Kinescope API; API использует bearer token, который должен оставаться server-side
([Kinescope API](https://docs.kinescope.com/api/)). Renderer строит единственный allowlisted
Kinescope component.

Для закрытых материалов domain restriction/private link недостаточны как membership check.
Kinescope поддерживает authorization backend: player получает подписанный JWT через
`drmauthtoken`, Kinescope спрашивает platform backend о доступе к конкретному video, а backend
возвращает `200` или `403`; документация рекомендует проверять `exp`, `aud` и `iss`
([Kinescope Authorization Backend](https://docs.kinescope.com/developer-guides/authorization-backend/)).
В production нужен `strict: true`, короткий token lifetime, сопоставление `videoId` с материалом и
тот же Membership rule, что для page. Дополнительно ограничить embedding approved domains; такая
настройка поддерживается Kinescope
([media privacy](https://docs.kinescope.com/catalog-and-video-management/media-file-settings/)).

## Safe rendering

Основной renderer должен обходить validated document tree и возвращать allowlisted React/HTML
components. Он не вставляет author-provided HTML через `dangerouslySetInnerHTML`. Для каждого node
есть exhaustive mapping; unknown node в текущей schema делает revision invalid, а old
`schemaVersion` сначала проходит migration adapter.

Дополнительные правила:

- validate link schemes и normalize external links; не разрешать `javascript:`, arbitrary `data:`
  и protocol-relative URLs;
- Kinescope — единственный iframe origin; CSP ограничивает `frame-src`, `script-src`, media/image
  origins и запрещает произвольные inline scripts;
- code highlighting работает над text и allowlisted grammar на server/build side, а не исполняет
  code;
- image/video wrappers сохраняют intrinsic aspect ratio; wide tables и code blocks получают
  bounded horizontal overflow, не расширяя mobile viewport;
- captions, alt, callout title и filenames рендерятся как text;
- ограничения на document bytes, node count, depth, table dimensions и URL length защищают
  validation/render от resource exhaustion;
- import HTML сначала sanitizes и затем map-ится в schema; raw HTML отбрасывается с warning.

Если какой-либо путь всё же производит HTML AST/string, его надо прогнать через allowlist sanitizer
после последнего unsafe transform. `rehype-sanitize`, например, удаляет всё, чего нет в schema
allowlist ([official README](https://github.com/rehypejs/rehype-sanitize/blob/main/readme.md)). CSP
остаётся defense in depth, а не заменой output encoding/sanitization; OWASP прямо предостерегает от
опоры только на CSP
([XSS Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html)).

## Search extraction

На каждом publish canonical tree детерминированно преобразуется в `SearchDocument`:

```ts
type SearchDocument = {
  contentId: string
  revisionId: string
  access: 'public' | 'member'
  title: string
  summary: string
  headings: string[]
  bodyText: string
  assetText: string[]       // alt, captions, download labels
  topicId: string
  formatId: string
  seriesIds: string[]
  tagIds: string[]
  publishedAt: string
}
```

Text extractor обходит известные nodes, вставляет semantic separators между blocks, не индексирует
URLs/tokens/storage metadata и по отдельной политике снижает вес либо исключает большие code
blocks. Kinescope title/transcript индексируется только если это отдельное подтверждённое platform
поле; provider metadata не становится каноном автоматически.

Search index — read projection. Внешнему search engine нужно передавать только поля, нужные для
matching/display/filtering; Algolia рекомендует именно такой selective record shape и нормализованные
facet values
([record preparation](https://www.algolia.com/doc/guides/sending-and-managing-data/prepare-your-data)).
Member body нельзя отправлять в публично запрашиваемый index/API key. Безопасные варианты —
отдельные public/member indices или обязательная server-side authorization/filtering, причём
публичная карточка закрытого материала индексирует только публичные title/summary/metadata.

## Revisions и schema evolution

Хранить отдельно:

- mutable `Content` identity и pointers `currentDraftRevisionId`/`publishedRevisionId`;
- immutable `ContentRevision` snapshots с actor, parent/base и source provenance;
- immutable/referenced assets либо explicit tombstone/retention lifecycle;
- idempotent search/render projections, привязанные к `revisionId`.

Migration policy:

1. Backend пишет только current `schemaVersion`.
2. Reader поддерживает каждую ещё существующую версию через pure deterministic chain
   `vN -> vN+1`; неизвестная версия fail-closed.
3. Изменения по возможности additive: новый optional attribute/default сначала, destructive rename
   только отдельной migration. Lexical также предупреждает, что несовместимое изменение JSON fields
   может повредить сохранённые данные, и рекомендует additive evolution либо новый type
   ([Lexical serialization](https://lexical.dev/docs/serialization/)).
4. Batch migration делает dry run, считает failures/warnings/reference changes, сохраняет исходные
   revisions и создаёт новую revision с actor `migration`; in-place rewrite истории запрещён.
5. Update pointers выполняется только после полного validation и rollback rehearsal. Published
   pointer не двигается незаметно, если migration меняет rendered semantics.
6. Fixture corpus всех nodes и старых versions проходит validate/render/text-extract/round-trip в CI.

## Agent/MCP editing contract

MCP не получает raw database access и не должен слепо отправлять RFC 6902 paths вида
`/doc/content/17/content/3`: array position становится неверной после соседней правки. Application
API предлагает semantic operations поверх стабильных IDs, например:

- `get_content(contentId, revisionId?)` — canonical JSON плюс validation и base revision;
- `replace_block(contentId, baseRevisionId, nodeId, block)`;
- `insert_blocks(contentId, baseRevisionId, afterNodeId, blocks)`;
- `delete_block(contentId, baseRevisionId, nodeId)`;
- `replace_text(contentId, baseRevisionId, nodeId, range, expectedTextHash, text)`;
- `set_node_attributes(...)` только для разрешённых fields;
- отдельные metadata/series/tag/asset commands;
- `validate_content`, `get_preview`, `prepare_publish`; actual publish требует owner GO.

Каждая операция возвращает new revision ID, normalized result и warnings. `baseRevisionId` плюс
узкая precondition предотвращают lost update. Whole-document replace разрешён для import/create и
явного restore, но не является default edit primitive. ProseMirror transforms/steps подходят для
editor undo и будущей collaboration — они записывают и replay-ят изменения
([ProseMirror transforms](https://prosemirror.net/docs/guide/)) — но экспортировать сырые positional
steps как публичный MCP contract в v1 не стоит: это сильнее связывает agent с внутренней schema и
текущими positions.

## Import из Obsidian, Telegram и файлов

### Markdown/Obsidian

Markdown — лучший ingress/egress, но не authority. Pipeline:

`bytes -> detect encoding -> frontmatter + Markdown parser -> mdast -> Obsidian extensions ->
canonical nodes/assets -> validation -> import report -> draft`.

`mdast` формализует CommonMark/GFM как syntax tree и расширяется frontmatter/MDX/GFM nodes
([mdast spec](https://github.com/syntax-tree/mdast)); generic directives имеют parse/serialize
extension, что удобно для явного переносимого синтаксиса custom blocks
([mdast directive](https://github.com/syntax-tree/mdast-util-directive)). Однако CommonMark core не
определяет callouts, Kinescope или asset identity, поэтому Inside Markdown profile должен быть
узким и versioned, а не «поддерживаем всё, что отрендерил Obsidian».

Obsidian поддерживает Markdown и собственные wikilinks, callouts, embeds и block references; его
документация отдельно отмечает, что block references не interoperable со standard Markdown
([syntax](https://obsidian.md/help/syntax), [links](https://obsidian.md/help/links)). Properties
хранятся как YAML вверху файла, а attachments — обычные files vault
([properties](https://obsidian.md/help/properties),
[attachments](https://obsidian.md/help/attachments)). Importer должен:

- разобрать YAML только в allowlisted candidate metadata, не принимать его без validation;
- resolve relative Markdown links, wikilinks и attachment paths внутри выбранного vault root;
- upload local attachments и заменить references на `assetId`;
- map поддерживаемые callouts; unknown Obsidian/plugin syntax сохранить в import report;
- запретить path traversal, remote fetch по умолчанию и raw HTML execution;
- сохранить source checksum/file path в provenance и дать author preview до authority transfer.

Markdown export — canonical-to-profile serialization для копирования в Obsidian/agent context. Он
может быть lossy для custom blocks и обязан сообщать warnings; round-trip equality не является v1
обещанием.

### Telegram archive

Для разовой миграции текущего архива предпочтителен **Telegram Desktop export JSON + media**:
официальный export tool выдаёт offline JSON или HTML и может включать photos/media
([Telegram export](https://telegram.org/blog/export-and-more)). Это воспроизводимый immutable input.
Bot API не является способом выгрузить старую историю: `messages.getHistory` доступен только user
authorization ([Telegram API](https://core.telegram.org/method/messages.getHistory)), а Bot API
download ограничен и требует временного `getFile` URL
([Bot API](https://core.telegram.org/bots/api)).

Telegram importer сначала создаёт staging records, сохраняя channel/message IDs, timestamp,
entities, caption, media group и source checksum. Затем author решает, какие сообщения/группы
образуют один полноценный material; короткие announcements и community discussion не становятся
материалами автоматически. Formatting/entities map-ятся в marks, media загружаются как Assets,
unsupported entities получают warning. Критерии mapping надо строить на sanitized fixtures из
реального export: формат export не следует угадывать только по Bot API.

### Generic files

V1 гарантирует `.md`/`.txt` и attachment bundle. DOCX/PDF не следует обещать как lossless structured
import без отдельного spike: parser output должен пройти ту же canonical validation, а исходный file
может быть сохранён как attached provenance artifact.

## Сравнение альтернатив

| Вариант | Сильные стороны | Риск для Inside v1 | Решение |
|---|---|---|---|
| Markdown string + mdast canonical | Лучший hand-editing, Obsidian/agent diff, понятный export; CommonMark имеет conformance spec, mdast — зрелый AST | Custom media/callouts требуют собственного dialect; rich editor round-trip и stable block identity сложнее; raw HTML опасен; formatting-only text patches конфликтуют с syntax | Отклонён как canonical; принят как import/export profile |
| **Versioned ProseMirror JSON + Tiptap** | Schema-constrained nested rich text, JSON serialization, mature rich editor, custom nodes, tables/code, static render; один body shape между editor/backend | Persisted node names связывают с schema; migrations обязательны; agent edits требуют stable IDs и semantic API | **Рекомендован** |
| Lexical JSON | Immutable serializable editor state, custom JSON/HTML nodes, headless mode, modular packages | Это прежде всего editor UI framework; runtime node keys не serialized; serialization/version evolution возлагается на custom nodes; нет преимущества, компенсирующего смену выбранной модели | Отклонён. Lexical подтверждает жизнеспособность JSON-tree class, но не лучший adapter здесь ([concepts](https://lexical.dev/docs/intro), [serialization](https://lexical.dev/docs/serialization/)) |
| Editor.js block JSON | Чистые blocks с IDs, простая перестановка и plugin model | `data` каждого block определяется Tool, inline fields могут содержать HTML и требуют tool-specific sanitizer; nesting/rich-text model и schema discipline слабее, больше plugin-owned contracts | Отклонён ([saved format](https://editorjs.io/saving-data/), [sanitizing](https://editorjs.io/sanitize-saved-data/)) |
| Portable Text + standalone editor | Открытая structured-block spec, stable keys, annotations/custom blocks, multi-target serializers; хороший runner-up | Потребуется собственная adapter/validation/migration обвязка; внутри собственного приложения не даёт преимущества Sanity Studio, ради которого ecosystem особенно силён | Отклонён для v1, оставить migration target. Portable Text хранит blocks/spans/marks/custom objects отдельно от presentation ([spec](https://www.portabletext.org/), [Sanity block content](https://www.sanity.io/docs/studio/block-content)) |
| Sanity/Contentful как headless CMS authority | Готовые schema/admin/draft/history/assets; Sanity даёт custom Portable Text blocks, Contentful — JSON rich text и linked entries/assets | Создаёт второй source of truth и второй permissions/workflow API рядом с обязательным platform application API/MCP; vendor revisions/access и platform publish/membership надо синхронизировать | Отклонён для v1. Contentful Rich Text также запрещает custom node types/marks, предлагая embedded entries из фиксированного набора ([Contentful Rich Text](https://www.contentful.com/developers/docs/concepts/rich-text/)) |
| Payload + Lexical/block CMS | Self-hosted admin и typed block fields; custom blocks живут в Lexical JSON | Приносит CMS application model и Lexical coupling целиком; table feature сейчас помечена experimental, что плохо для выбранной v1 schema с таблицами | Отклонён как content authority ([Payload features](https://payloadcms.com/docs/rich-text/official-features), [blocks](https://payloadcms.com/docs/rich-text/blocks)) |

Почему не отдельная «идеально portable» Inside block schema плюс Tiptap adapter: она создаст две
структурные модели, двусторонний conversion и дополнительную loss boundary до появления второго
реального consumer. В v1 ProseMirror JSON уже является semantic tree. Отделить application-owned
envelope, commands, IDs и references достаточно; если второй editor/channel предъявит требования,
его evidence станет основанием новой schema или migration.

Portable Text остаётся наиболее сильным challenger, но его canonical GitHub specification на
момент исследования маркирует себя `v0.0.1 WORKING DRAFT`
([official specification](https://github.com/portabletext/portabletext)). Это не запрещает
использование, однако повышает цену собственной compatibility policy и не перевешивает более
прямой Tiptap/ProseMirror path для v1.

## Риски и меры

| Риск | Вероятность/влияние | Мера |
|---|---|---|
| Schema drift между editor, backend и renderer | Средняя/высокое | Один versioned `content-schema` module, fixture corpus, exhaustive mappings и compatibility CI |
| Повреждение истории при node rename/removal | Средняя/высокое | Additive first, pure migrations, immutable originals, dry run и rollback rehearsal |
| Agent перезапишет чужую правку | Средняя/высокое | `baseRevisionId`, semantic node ops, text hash preconditions, `409` |
| XSS/unsafe embed/import | Средняя/критическое | Нет raw HTML/MDX, allowlisted nodes/URLs, server renderer, sanitizer defense in depth, CSP |
| Утечка закрытого image/file/search text | Средняя/критическое | Private object storage, auth before signed URL, access-scoped search projection, no signed URLs in canon/cache |
| Kinescope video откроется вне Membership | Средняя/высокое | Authorization backend `strict: true`, signed short JWT, video mapping, domain restriction, negative tests |
| Import тихо потеряет semantics/assets | Высокая/среднее | Staging + warnings + source provenance + author preview; no silent publish |
| Tiptap replacement cost | Низкая/среднее | Не сохранять editor/plugin state, держать domain commands/render/import outside React, version schema |

## Bounded spikes до ADR

### Spike A — schema/editor/render round-trip (2 engineering days)

Собрать минимальный Tiptap editor и server renderer на fixture, содержащем каждый v1 node/mark.

Acceptance:

- JSON проходит backend runtime + ProseMirror schema validation;
- edit → save → reload не меняет semantics и сохраняет `nodeId`;
- все nodes имеют explicit server render mapping, unknown node fail-closed;
- SSR output не содержит raw author HTML; links/embeds проходят negative security fixtures;
- plain-text/search projection детерминирован для того же revision.

### Spike B — MCP semantic patching и concurrency (1–2 engineering days)

Реализовать in-memory/API prototype `insert/replace/delete block` и `replace_text`.

Acceptance:

- agent меняет paragraph, callout и media attrs по stable ID без positional JSON paths;
- stale `baseRevisionId` даёт `409`, не lost update;
- повтор операции с idempotency key не создаёт второй эффект;
- invalid nesting/reference/oversize возвращает structured validation errors;
- editor сохраняет и открывает agent-produced revision без normalization drift.

### Spike C — representative import (2 engineering days плюс подготовка fixtures)

Взять owner-approved sanitized sample реального Telegram Desktop export и Obsidian vault с
frontmatter, links, callouts, code/table и attachments.

Acceptance:

- каждый source item и attachment либо mapped, либо перечислен в machine-readable warning;
- imported assets имеют checksum и canonical IDs, broken/path-traversal links блокируются;
- повторный import с тем же source key/checksum не создаёт дубли;
- author видит staging preview и provenance до создания/publish draft;
- результат проходит те же validate/render/search fixtures, что admin content.

### Spike D — private asset + Kinescope access (1–2 engineering days, согласовать с video/access research)

Acceptance:

- public, active member, expired member и anonymous cases проверены для page, image, download и video;
- direct storage object закрыт, signed asset URL short-lived и не находится в canonical/search/log;
- Kinescope JWT истекает, подмена user/video отклоняется, auth backend работает в strict mode;
- embed разрешён только approved origins и остаётся responsive;
- failure Kinescope/auth backend даёт controlled unavailable state, не bypass.

### Spike E — schema migration rehearsal (1 engineering day)

Создать искусственный `v1 -> v2` rename/default migration на fixture corpus.

Acceptance:

- migration deterministic и idempotent, original revision не изменяется;
- dry run перечисляет affected/failures и render/search diff;
- old и migrated revision render до pointer switch;
- rollback возвращает исходный pointer без потери revision/asset references.

## Открытые owner decisions

1. Утвердить направление **versioned ProseMirror JSON + Tiptap** как input в ADR или потребовать
   отдельный spike Portable Text vs ProseMirror на реальном материале.
2. Утвердить точный v1 formatting set: heading levels, strike, blockquote, nested lists, table limits,
   code languages и callout tones. Рекомендация выше — минимальная, но fixtures должны исходить из
   аудита реального контента.
3. Подтвердить, что real-time multi-author collaboration остаётся за v1; тогда CRDT/Yjs не входит в
   storage contract.
4. Определить policy удаления и retention assets/revisions: рекомендация — published snapshots и
   referenced binaries не hard-delete обычной author operation.
5. Подтвердить уровень Kinescope protection и доступность нужного provider plan. Для закрытого body
   security baseline — authorization backend strict mode; domain-only restriction неэквивалентна
   Membership authorization.
6. Выбрать sanitized representative Telegram/Obsidian fixtures и owner rules, какие channel posts
   являются материалами; это нельзя вывести только из формата.
7. Решить, индексируется ли code body и будут ли Kinescope transcripts частью v1. По умолчанию:
   code — с меньшим search weight, transcripts — out до появления canonical reviewed text.

## Граница будущего ADR

ADR после owner approval должен зафиксировать: canonical ProseMirror JSON envelope и schema
ownership; Tiptap как v1 adapter; immutable revision/pointer model; typed asset/Kinescope references;
semantic MCP commands и optimistic concurrency; safe renderer и access-aware projections;
Markdown/Telegram как import boundaries; migration guarantees. ADR не должен преждевременно
выбирать database vendor, object storage vendor, search engine, UI styling или полный API endpoint
design — эти решения не нужны, чтобы утвердить content model.
