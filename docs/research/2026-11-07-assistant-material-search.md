# Помощник: поиск по материалам

Исследование к [#1978](https://github.com/sachkov-inside/platform/issues/1978), 07.11.2026.
Карта: [#1975](https://github.com/sachkov-inside/platform/issues/1975).
Решения владельца: [#1976](https://github.com/sachkov-inside/platform/issues/1976).
Основа проекта: `2a6006e17c5483700e7149cf260e14fb44ade016`.
Код прочитан в репозитории. Внешние факты взяты из первичных источников со ссылками.
Docker, локальный стенд и запросы к провайдерам модели в этом исследовании не запускались.

## Коротко

Рекомендация: гибридный поиск по частям материалов.
Полнотекстовый поиск PostgreSQL и векторный поиск дают по списку, слияние идёт по RRF.
Векторы хранит pgvector без индекса, поиск точный: частей будет несколько тысяч.
Reranker в первой версии не нужен. Его включают, только если evals покажут выигрыш.
Нарезку строит Materials по заголовкам в той же транзакции Save, векторы считает фоновая задача.
Доступ проверяет `ContentAccess` после поиска. Текст закрытого материала в модель не попадает.

| Вопрос | Ответ |
| --- | --- |
| Поиск | Гибрид: FTS `russian` + `english` + `simple` и pgvector, слияние RRF с `k = 60` |
| Индекс векторов | Нет, точный перебор. HNSW только при росте до сотен тысяч частей |
| Модель эмбеддингов | Кандидаты `text-embedding-3-small` и `qwen3-embedding-8b` через AITunnel, выбор по evals |
| Часть материала | Раздел по заголовку, 200-500 токенов, граница только между блоками |
| Обновление | Части в транзакции Save, векторы асинхронно по хешу текста |
| Доступ | `checkAvailabilityMany` после поиска: `available` с текстом, `locked` только ссылка на курс |
| Ссылка | `/materials/<slug>#<якорь>` через `materialHeadingAnchors` |
| Программа курса | Отдельный инструмент со структурой, без поиска |
| Готовые ответы | Тот же гибрид в схеме `assistant`, фильтр по аудитории |

## Что есть в коде сейчас

### Поиск по каталогу не видит текст материала

Публичный поиск ищет по `materials.published_materials.search_vector`.
Колонку создаёт миграция
[`0009-published-material-search.ts`](../../apps/backend/src/modules/materials/infrastructure/postgres/migrations/0009-published-material-search.ts).
В вектор входят три поля с весами:

| Вес | Поле | Что в нём |
| --- | --- | --- |
| A | `title` | Заголовок материала |
| B | `summary` | Краткое описание |
| C | `public_search_text` | Тема, формат, теги, названия и описания Products |

Каждое поле разбирается тремя конфигурациями: `russian`, `english` и `simple`.
Запрос строит `websearch_to_tsquery` с теми же тремя конфигурациями, ранг считает `ts_rank_cd`.
Код запроса лежит в
[`published-material-projection.ts`](../../apps/backend/src/modules/materials/infrastructure/postgres/published-material-reader/published-material-projection.ts)
(функции `textSearchQuerySql` и `searchRankSql`).
`public_search_text` пересчитывает
[`published-material-search.ts`](../../apps/backend/src/modules/materials/infrastructure/postgres/published-material-search.ts).

Текст тела материала в этот вектор не входит.
Он хранится отдельно в `materials.material_search_documents.plain_text`.
Индекса по этой колонке нет. Сейчас её читает только выдержка заметки (первые 1200 символов).
Значит, текущий поиск находит материал по названию и описанию, но не по ответу внутри урока.
Для Помощника этого мало при любом выборе ниже.

### Поисковый текст блоков

Реестр `@inside/material-blocks` даёт каждому виду блока метод `text`
([`block-definition.ts`](../../packages/material-blocks/src/block-definition.ts)).
Обход делает `materialBlockText`
([`extract.ts`](../../packages/material-blocks/src/extract.ts)).
`extractMaterialBody`
([`render-material-body.ts`](../../apps/backend/src/modules/materials/domain/material-body/render-material-body.ts))
склеивает текст блоков верхнего уровня в `plainText` и собирает заголовки.
Что отдаёт `text` у разных блоков:

| Блок | Поисковый текст |
| --- | --- |
| `heading`, `paragraph`, `key_point` | Текст строки |
| `callout`, `takeaways` | Название и вложенные блоки |
| `code_block` | Код целиком |
| `agent_prompt` | Название и текст промпта |
| `table`, списки, `labeled_list` | Текст ячеек и пунктов |
| `variant` | Текст всех вариантов режима курса |
| `quiz` | Только вопрос, без вариантов и пояснений |
| `video` | Описание и названия глав, без расшифровки |
| `resource_card` | Название, описание и URL |
| изображение, файл | `alt`, подпись, название файла |
| `horizontal_rule` | Пустая строка |

Важная деталь про квизы. `quiz.text` отдаёт только вопрос.
Но `quiz.children` возвращает и варианты, и пояснения
([`quiz.ts`](../../packages/material-blocks/src/blocks/quiz.ts)).
Поэтому нарезка для Помощника должна брать текст через `materialBlockText`,
а не обходом `materialBlockChildren`. Иначе ответы квизов попадут в индекс.
Это прямо нарушит границу #1059 «не называет ответы квизов».

### Где меняется публикация

События публикации нет. Все изменения идут через одну полную операцию Save
([ADR 0009](../adr/0009-one-mutable-material.md)).
Её код:
[`save-material.ts`](../../apps/backend/src/modules/materials/features/save-material/save-material.ts).

- Состояние Published: `replacePublishedProjections` в той же транзакции пишет
  `published_materials`, теги, программу Product и `material_search_documents`.
- Состояние Draft или Unpublished: та же транзакция удаляет `published_materials`
  и `material_search_documents`.
- `transition-material-publication` вызывает тот же Save.
- Изменение Product или коллекции вызывает `refreshPublishedMaterialSearchProjections`
  со скоупом `product` или `topic`
  ([`product-materials.ts`](../../apps/backend/src/modules/materials/adapters/products/product-materials.ts),
  [`update-content-collection.ts`](../../apps/backend/src/modules/materials/features/update-content-collection/update-content-collection.ts)).

ADR 0009 требует: публичные и поисковые проекции обновляются в той же успешной Save.
Строка `material_search_documents` ссылается на `(material_id, content_version)`.
Так устаревшая строка не переживает новую версию материала.
Для внешних действий есть outbox в той же транзакции
([`notification-outbox.ts`](../../apps/backend/src/modules/materials/facets/notification-outbox/notification-outbox.ts)).

### Как решается доступ

Доступ решает `ContentAccess`
([`content-access.interface.ts`](../../apps/backend/src/modules/content-access/facets/content-access/content-access.interface.ts)).
Метод `checkAvailabilityMany` отвечает для пачки до 100 ресурсов
(`CONTENT_ACCESS_BATCH_SIZE`): `available`, `locked` или `unavailable`.
Метод `checkProductAccessMany` отвечает, открыт ли Product целиком.
Правила в
[`assemble-content-access.ts`](../../apps/backend/src/modules/content-access/facets/content-access/assemble-content-access.ts)
сложнее простого фильтра:

- открытый материал вне Product доступен всем;
- открытый материал внутри Product требует вход через Telegram (#1825);
- закрытый материал требует Product Access к одному из его Products
  ([ADR 0040](../adr/0040-unified-product-access.md));
- материал, у которого все Products в архиве, читает только получивший доступ;
- менеджер материалов (`materials:manage`) читает всё.

Тот же приём уже работает в учебном MCP. `learning_materials_list` отдаёт закрытые материалы
как тизеры без тела
([`learning-materials-mcp.ts`](../../apps/backend/src/modules/content-library/adapters/mcp/learning-materials-mcp.ts)).
`learning_material_read` отдаёт полное тело только после `authorize`.
Инструмента поиска в учебном MCP нет.

### Как дать точную ссылку

Адрес материала задаёт `materialReaderPath`: `/materials/<slug>`
([`announcement.ts`](../../apps/backend/src/modules/materials/domain/announcement.ts)).
Slug не меняется после первой публикации (ADR 0009).
Якорь раздела строит `materialHeadingAnchors`
([`heading-anchors.ts`](../../packages/material-blocks/src/heading-anchors.ts)).
Он берёт текст заголовка, переводит в нижний регистр, убирает знаки и добавляет суффикс к повтору.
Reader использует ту же функцию
([`material-body-view.tsx`](../../apps/web/src/entities/material/ui/material-body-view.tsx)).
Значит, сервер может построить `/materials/<slug>#<якорь>`, и он совпадёт с якорем на странице.
Контекст курса добавляют параметры `from` и `anchor`, например
`/materials/practical-lesson?from=%2Fproducts%2Fai-engineering%2Fprogramme`.
Якорь есть только у заголовков. У абзаца или блока своего адреса нет.
Якорь меняется, если автор меняет текст заголовка.

### Программа курса

Программа курса (ProductProgramme) хранится в Products как структура: главы, места в программе,
приложения ([ADR 0035](../adr/0035-product-catalogue-programme-and-attachments.md)).
Её читает `read-published-product-composition`
([папка](../../apps/backend/src/modules/products/features/read-published-product-composition/)).
Программа невелика и полностью структурирована. Её лучше отдавать модели инструментом
«программа курса», а не искать по ней векторами.

### Что уже есть рядом

Telegram-приложение уже ищет по вопросам сообщества полнотекстовым поиском `russian`
([миграция 044](../../apps/telegram/src/database/migrations/044-community-discussion-history.ts),
[описание](../../apps/telegram/docs/integrations/community-discussions-v1.md)).
Там же у обсуждения есть статус `used` и список `material_urls`
([миграция 041](../../apps/telegram/src/database/migrations/041-community-discussions.ts)).
Это готовый источник реальных вопросов с правильным материалом для evals.
Telegram-приложение вызывает модель через AI SDK (`ai`, `@ai-sdk/openai-compatible`).

### Образ PostgreSQL

Compose и production используют `ghcr.io/sachkov-inside/postgres:18.4-alpine3.23`
([compose.yaml](../../compose.yaml),
[production Dockerfile](../../infra/production/database/Dockerfile)).
Это побайтовая копия официального `postgres:18.4-alpine3.23`
([official-runtime-mirror.yml](../../.github/workflows/official-runtime-mirror.yml)).
CI и интеграционные тесты используют копию `postgres:18.4-alpine`
([postgres.global.ts](../../apps/backend/test/integration/setup/postgres.global.ts)).
Ни одна миграция backend не создаёт расширения (`create extension` в коде нет).

## Внешние факты

### pgvector и образ PostgreSQL

| Факт | Источник |
| --- | --- |
| Последний релиз 0.8.7, 01.10.2026 | [CHANGELOG](https://github.com/pgvector/pgvector/blob/master/CHANGELOG.md) |
| PostgreSQL 18 поддерживается с 0.8.1 (04.09.2025); 0.8.2 и 0.8.3 исправили ошибки на 18 | там же |
| Без индекса поиск точный, полнота 100% | [README](https://github.com/pgvector/pgvector#readme) |
| HNSW и IVFFlat индексируют `vector` до 2000 измерений, `halfvec` до 4000 | README |
| Фильтр `where` с приблизительным индексом применяется после обхода индекса | README, раздел Filtering |
| С 0.8.0 есть `hnsw.iterative_scan`, он добирает строки после фильтра | README |
| README предлагает гибрид: FTS PostgreSQL и RRF | README, раздел Hybrid Search |

Официальный образ `postgres` не содержит pgvector.
Его Debian-вариант ставит PostgreSQL из PGDG, и там есть пакет `postgresql-18-pgvector` 0.8.7
([пул PGDG](https://apt.postgresql.org/pub/repos/apt/pool/main/p/pgvector/)).
Готовый образ `pgvector/pgvector` имеет теги `pg18`, `pg18-trixie`, `0.8.7-pg18`
([Docker Hub](https://hub.docker.com/r/pgvector/pgvector/tags)).
Но у нас образ Alpine: `postgres:18.4-alpine3.23`.
Пакет PGDG к нему не подходит, а пакет Alpine собран под другой PostgreSQL.
Значит, pgvector придётся собрать из исходников в нашем Dockerfile, как уже собран pgBackRest.
Для этого нужен отдельный образ для Compose, CI и интеграционных тестов.
Сейчас они берут копию официального образа без изменений.
Официальный образ сейчас дошёл до 18.6. Наша закреплённая версия 18.4 этим исследованием не меняется.

Оценка без проверки: точный перебор нескольких тысяч векторов занимает единицы миллисекунд.
Проверить её нужно через `EXPLAIN ANALYZE` на реальном объёме.

### Модели эмбеддингов через AITunnel

AITunnel даёт OpenAI-совместимый `POST https://api.aitunnel.ru/v1/embeddings`
([документация](https://aitunnel.ru/docs/embeddings)).
Параметр `dimensions` работает там, где его поддерживает модель.
Есть и `POST /v1/rerank` ([документация](https://aitunnel.ru/docs/rerank)).
Он не входит в OpenAI SDK, его вызывают обычным HTTP.
Цены взяты из каталога
[эмбеддингов](https://api.aitunnel.ru/public/aitunnel/models/embeddings) и
[rerank](https://api.aitunnel.ru/public/aitunnel/models/rerank) 07.11.2026.
Единица цены выведена из карточки модели: рубли за 1 млн входных токенов.

| Модель | ₽ за 1 млн токенов | Размер вектора | Вход, токенов | Замечание |
| --- | --- | --- | --- | --- |
| `text-embedding-3-small` | 4 | 1536, можно сократить | 8192 | MTEB 62,3 у OpenAI |
| `text-embedding-3-large` | 26 | 3072, можно сократить | 8192 | MTEB 64,6 у OpenAI |
| `qwen3-embedding-8b` | 2 | 4096, MRL | 40960 | Multilingual MTEB 70,58 |
| `qwen3-embedding-4b` | 4 | 2560, MRL | 32768 | Multilingual MTEB 69,45 |
| `gemini-embedding-001` | 30 | 3072, MRL | 20000 | |
| `voyage-4` | 12 | | 32000 | |
| `gigachat-embeddings-giga-r` | 24 | | 4096 | Российский провайдер |

Источники размеров и оценок:
[OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings),
[Qwen3-Embedding](https://huggingface.co/Qwen/Qwen3-Embedding-8B).
MRL (Matryoshka) значит, что вектор можно обрезать до меньшего размера.
Для индекса HNSW вектор `qwen3-embedding-8b` придётся обрезать до 2000. Для точного перебора не нужно.
`bge-m3` и `multilingual-e5` в AITunnel нет. Их можно только развернуть самим.

Русский бенчмарк ruMTEB ([arXiv 2408.12503](https://arxiv.org/abs/2408.12503), данные на 09.10.2024)
не проверял модели OpenAI, Qwen3 и Gemini.
Поэтому прямого сравнения нужных нам моделей на русском нет. Выбор должен дать собственный набор evals.

Цена индексации ничтожна. Курс в сотни материалов по 3-8 тыс. токенов даёт 1-3 млн токенов.
Полная переиндексация `text-embedding-3-small` стоит до 12 ₽, `qwen3-embedding-8b` до 6 ₽.
Вопрос ученика короче 100 токенов, его вектор стоит доли копейки.

### Что говорит практика о гибриде

| Источник | Что показано |
| --- | --- |
| [RRF, Cormack и др., SIGIR 2009](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf) | Сумма `1 / (k + место)` с `k = 60` стабильно лучше каждой системы. Данные TREC, не векторы |
| [BEIR, arXiv 2104.08663](https://arxiv.org/abs/2104.08663) | BM25 устойчив на новых доменах. Многие векторные модели хуже его. BM25 с cross-encoder лучше всего |
| [BGE-M3, arXiv 2402.03216](https://arxiv.org/abs/2402.03216), MIRACL ru, nDCG@10 | BM25 25,6; dense 70,1; dense + sparse 69,8; все три способа 71,7 |
| [Anthropic Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval), 19.09.2024 | Провалы поиска в top-20: эмбеддинги с контекстом минус 35%, плюс BM25 минус 49%, плюс reranker минус 67% |

Вывод для русского текста осторожный. На общем русском тексте (MIRACL) векторный поиск сильно лучше
лексического, а добавка лексического почти ничего не даёт.
Но MIRACL состоит из Википедии. В наших уроках много кода, команд и английских имён: `MCP`, `CLAUDE.md`, `tsvector`.
Такие точные строки лексический поиск находит надёжнее векторного.
Anthropic показывает выигрыш гибрида на своих наборах, среди которых есть код и научные статьи.
Поэтому гибрид здесь нужен как страховка для точных строк. Слияние RRF стоит один SQL-запрос.

Готовые примеры гибрида в PostgreSQL:
[pgvector-python `hybrid_search/rrf.py`](https://github.com/pgvector/pgvector-python/tree/master/examples/hybrid_search),
[Supabase hybrid search](https://supabase.com/docs/guides/ai/hybrid-search) (`rrf_k = 50`),
[ParadeDB](https://www.paradedb.com/docs/reference/hybrid/rrf) (`k = 60`, 100-200 кандидатов на ветку).

### Ограничения полнотекстового поиска PostgreSQL

Документация PostgreSQL 18
([textsearch-controls](https://www.postgresql.org/docs/18/textsearch-controls.html)):

- `ts_rank` и `ts_rank_cd` не используют глобальную статистику. Это не BM25: редкое слово не весит больше частого.
- Snowball для русского отрезает окончания. Синонимы и тезаурус нужно задавать словарём вручную.
- Опечаток поиск не прощает. Для них есть `pg_trgm` из contrib.

BM25 дают расширения `pg_textsearch` (Timescale, лицензия PostgreSQL) и `pg_search` (ParadeDB, AGPL-3.0).
Оба требуют `shared_preload_libraries`. Для нескольких тысяч частей выигрыш BM25 над `ts_rank_cd`
не стоит нового расширения в образе.

### Нарезка структурных документов

| Источник | Правило |
| --- | --- |
| [OpenAI file search](https://developers.openai.com/api/docs/guides/retrieval) | 800 токенов, перекрытие 400 по умолчанию |
| [LangChain MarkdownHeaderTextSplitter](https://python.langchain.com/docs/how_to/markdown_header_metadata_splitter/) | Резать по заголовкам, путь заголовков хранить как метаданные |
| [AITunnel RAG](https://aitunnel.ru/docs/rag) | Абзацы и заголовки, 200-500 токенов, перекрытие около 50 |
| Anthropic Contextual Retrieval | Несколько сотен токенов и 50-100 токенов контекста перед частью |

### Проверка качества поиска

- Recall@k: доля вопросов, у которых нужная часть есть в первых k результатах.
- MRR: среднее `1 / место` первой нужной части.
- nDCG@10: учитывает степень релевантности и место
  ([Järvelin, Kekäläinen, 2002](https://doi.org/10.1145/582415.582418)). BEIR считает nDCG@10 и Recall@100.
- Faithfulness (обоснованность ответа): доля утверждений ответа, которые следуют из найденного текста
  ([RAGAS, arXiv 2309.15217](https://arxiv.org/abs/2309.15217), [документация](https://docs.ragas.io/)).
- Langfuse умеет datasets, experiments, LLM-as-a-judge и свои оценщики в коде
  ([документация](https://langfuse.com/docs/evaluation/overview)).

## Сравнение вариантов

| Критерий | FTS PostgreSQL | Векторный поиск | Гибрид RRF |
| --- | --- | --- | --- |
| Перефразированный вопрос «как агенту не забывать прошлое» | Плохо: нужны те же слова | Хорошо | Хорошо |
| Точная строка: команда, имя файла, ошибка | Хорошо | Нестабильно | Хорошо |
| Русская морфология | Snowball | Модель | Оба |
| Новая инфраструктура | Нет | pgvector в образе, вызов модели | То же, что вектор |
| Стоимость | 0 | Единицы рублей за переиндексацию | То же |
| Задержка | Миллисекунды | Плюс вызов эмбеддинга вопроса, около 100-300 мс (оценка) | То же |
| Отказ провайдера | Не влияет | Поиск не работает | Остаётся FTS |
| Объяснимость | Совпавшие слова видны | Нет | Частично |

Отдельный вариант для малого корпуса: положить весь курс в prompt.
Anthropic советует так делать при базе до 200 тыс. токенов.
Один курс Inside, вероятно, больше: сотни материалов по несколько тысяч токенов.
К тому же модель должна видеть только доступные материалы, а сплошной prompt этого не даёт.
Вариант отклонён.

Вариант без pgvector тоже возможен. Векторы хранятся в `real[]`, сходство считает Node.js.
На нескольких тысячах частей это быстро. Но тогда backend держит векторы в памяти и сам их обновляет.
Слияние с FTS уходит из SQL в код. Сборка pgvector проще этой поддержки.

## Рекомендация

1. Гибридный поиск. FTS по частям с тремя конфигурациями, как в миграции 0009. Векторы pgvector.
   Каждая ветка даёт до 50 кандидатов. Слияние RRF с `k = 60`. Модель получает до 20 частей.
2. Индекса HNSW нет. Точный перебор даёт полную полноту и снимает проблему фильтра после индекса.
   Индекс нужен только при росте до сотен тысяч частей.
3. Reranker не входит в первую версию. AITunnel его даёт: `rerank-v3.5` около 0,18 ₽ за запрос
   ([каталог](https://api.aitunnel.ru/public/aitunnel/models/rerank)).
   Его включают, если на evals он поднимает recall@5 заметно, например на 5 пунктов.
4. Модель эмбеддингов выбирают evals из двух кандидатов: `text-embedding-3-small` и `qwen3-embedding-8b`.
   Если разница меньше погрешности, берём `text-embedding-3-small`: короче вектор и проверенный SDK.
5. Отказ провайдера эмбеддингов не ломает поиск. Помощник ищет только FTS и пишет это в трассу.

Почему не только FTS. Текущий поиск даже не смотрит в тело материала.
Ученик спрашивает своими словами, а лексический поиск требует слов автора.
Почему не только векторы. В курсе много точных строк кода и команд, их надёжнее ловит FTS.
Почему стоит при сотнях материалов. Деньги ничтожны, а цена ошибки высокая:
Помощник без нужного раздела ответит «в курсе этого нет», хотя ответ в курсе есть.
Главная цена: сборка pgvector в нашем образе Alpine и в образах CI.

## Нарезка

Часть материала (в коде предлагаю `MaterialPassage`, термин решает #1983) строится так:

1. Обойти блоки верхнего уровня `MaterialBody` по порядку.
2. Начинать новую часть на каждом `heading` уровня 2 и 3. Уровень 4 остаётся внутри части.
3. Текст блока брать только через `materialBlockText`. Обход `materialBlockChildren` запрещён: он раскрывает ответы квизов.
4. Если часть длиннее 500 токенов, делить её между блоками. Блок кода не резать. Длинный код укорачивать только в тексте для эмбеддинга.
5. Если часть короче 50 токенов, присоединять её к следующей части того же раздела.
6. Перед текстом ставить строку контекста: Product, глава, материал, путь заголовков.
   Пример: «Курс AI Engineering › Глава 2 › Урок "Контекст агента" › Память между сессиями».
   Это дешёвая версия Contextual Retrieval без вызова модели.
7. Каждая часть хранит `material_id`, `content_version`, порядковый номер, путь заголовков, якорь,
   путь первого блока, текст и SHA-256 текста.

Отдельные части без заголовка:

- материал без заголовков: вступление до первого заголовка становится первой частью;
- `title`, `summary` и `outcomes` материала дают отдельную часть «О материале»;
- `variant`: текст обоих режимов курса, как в текущем поиске, с отметкой режима;
- `agent_prompt`: текст входит в поиск. Отдавать ли его модели целиком, решает #1983, см. открытые вопросы;
- `video`: только описание и главы. Расшифровок нет, это задача на потом.

## Обновление индекса

| Изменение | Где | Что делать |
| --- | --- | --- |
| Save в Published | `replacePublishedProjections` | В той же транзакции заменить части материала на части новой версии |
| Save в Draft или Unpublished | ветка удаления в `save-material.ts` | В той же транзакции удалить части |
| Product, глава, тема переименованы | `refreshPublishedMaterialSearchProjections` | Пересчитать строку контекста в скоупе |
| Новый текст части | Фоновая задача | Посчитать вектор |

Части и FTS не требуют сети, поэтому живут в транзакции Save, как требует ADR 0009.
Вектор требует вызова провайдера, поэтому его считает фоновая задача после фиксации.
Задача выбирает части без вектора для текущей модели и пишет вектор по ключу `(sha256, model)`.
Неизменённый раздел сохраняет хеш, поэтому правка одного абзаца не пересчитывает весь материал.
Пока вектора нет, часть находит только FTS. Ученик видит новое содержание сразу.
Смена модели означает новую колонку или таблицу и фоновую переиндексацию, без остановки поиска.

Права доступа в индекс не копируются. Доступ решает `ContentAccess` в момент запроса.
Поэтому выдача, отзыв доступа и архив Product индекс не трогают.

## Фильтр по правам Account

Порядок одного вызова инструмента «поиск по материалам»:

1. Сервер берёт Subject из сессии, а не из текста разговора (#1976).
2. Поиск идёт по всем частям Published материалов. Части Draft и Unpublished не существуют.
3. Если чат открыт со страницы курса, части этого Product получают приоритет.
   Простой способ: два запроса, сначала в курсе, затем везде, с объединением.
4. Кандидаты группируются по материалу. До 100 материалов уходят в один `checkAvailabilityMany`
   с новой точкой проверки, например `assistant_retrieval`.
5. `available`: модель получает текст части и ссылку.
6. `locked`: модель получает только название материала и ссылку на страницу курса. Текста нет.
   Так Помощник говорит «тема есть в этом курсе», как решил владелец, и не может пересказать содержание.
7. `unavailable`: материал выпадает из ответа, факт пишется в трассу.
8. Открытый материал в Product без входа через Telegram даёт `locked` по правилу #1825.
   Помощник ведёт ученика к привязке Telegram через Сценарий.

Фильтр после поиска безопасен, потому что поиск точный и кандидатов много.
Закрытые материалы могут вытеснить доступные из top-20. Поэтому каждая ветка даёт 50 кандидатов,
и фильтр идёт до обрезки до 20.

Ссылка строится на сервере: `/materials/<slug>#<якорь>`, при контексте курса с `from`.
Модель не сочиняет URL. Она выбирает часть по идентификатору, сервер подставляет адрес.
Evals проверяют, что каждая ссылка ответа ведёт на одну из найденных частей.

## Готовые ответы и программа курса

Готовых ответов будут десятки. Они живут в схеме `assistant` и ведутся в админке (#1976).
Их ищет тот же гибрид по вопросу, вариантам вопроса и тексту ответа.
У Готового ответа есть аудитория (термин Prepared Answer в ветке `docs/1975-assistant-glossary`).
Фильтр по аудитории проверяет сервер до передачи модели, тем же правилом, что и материалы.

Программа курса не нуждается в поиске. Инструмент «программа курса» отдаёт главы, уроки,
статусы доступа и прогресс из Products и Reading Activity. Он сам меньше любого prompt.

## Открытые вопросы для #1983 «Помощник: техническое устройство»

1. Кто владеет частями и векторами. Вариант А: Materials владеет частями и векторами
   и даёт фасад поиска. Вариант Б: Materials даёт части, модуль `assistant` хранит векторы.
   Рекомендую А: части и FTS обязаны жить в транзакции Save, а чужие таблицы читать нельзя.
2. Сборка pgvector в образе Alpine: production Dockerfile, отдельный образ для Compose, CI и testcontainers.
   Это изменение production-образа базы, нужно решение владельца.
3. Фоновая задача векторов: свой цикл в backend или outbox Materials.
4. Название точки проверки доступа и инструмента поиска.
5. Отдавать ли модели текст `agent_prompt` целиком. #1059 запрещает давать готовые промпты.
   Вариант: в поиск текст входит, модель получает только название блока и ссылку.
6. Отправка вопроса ученика провайдеру эмбеддингов попадает под то же решение по 152-ФЗ, что и модель.
7. Нужен ли адрес у блока, а не только у заголовка. Сейчас якорь есть только у заголовка
   и меняется вместе с его текстом.

## Открытые вопросы для #1981 «Помощник: набор evals»

1. Источник вопросов. Предлагаю обсуждения сообщества со статусом `used` и `material_urls` из Telegram-приложения.
   Это реальные вопросы с правильным материалом. Нужно решить, как убрать из них личные данные.
2. Размер набора: 50-100 вопросов на старте, с ожидаемым материалом и якорем.
3. Метрики поиска: recall@5, recall@20 и MRR для FTS, вектора, гибрида и гибрида с reranker.
4. Метрики ответа: обоснованность (faithfulness), верная ссылка, отказ «в курсе этого нет» без ложного отказа.
5. Случаи доступа: закрытый материал не даёт текста, `locked` ведёт на страницу курса, квиз не раскрывает ответ.
6. Порог: какой выигрыш reranker или другой модели оправдывает включение.
7. Где хранить набор: Langfuse datasets или файл в репозитории. Решение #1976 требует evals перед изменением инструкций.

## Что не проверено

- Задержка точного перебора pgvector на нашем объёме. Нужен `EXPLAIN ANALYZE`.
- Качество моделей на наших вопросах. Публичного сравнения OpenAI и Qwen3 на русском нет.
- Единица цены AITunnel выведена из карточки модели, а не из явного прайса.
- Сборка pgvector под `postgres:18.4-alpine3.23` не запускалась.
- Число материалов и их размер оценены по тикету, а не измерены.
