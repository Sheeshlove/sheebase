# Модель данных ШИБЕЙС

Документ для отчёта по работе 2.1. Источник — [SPEC.md](SPEC.md), раздел 7.

> Состояние на 2026-11-12: схема Drizzle и миграции есть для всех таблиц, кроме поиска (раздел 2.7, этап M8).
> Таблицы ниже ведутся вручную; тест `packages/db/src/schema/schema.test.ts` проверяет, что в них перечислены все
> столбцы схемы. Генератора `pnpm docs:data-model` пока нет.

## 1. Где что хранится

| Хранилище                                           | Что хранит                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| PostgreSQL 17                                       | Аккаунты, пространства, дерево страниц, задачи, связи, файлы (метаданные), запуски ИИ, поисковый индекс, журналы |
| Y.Doc (в PostgreSQL, столбец `yjs_documents.state`) | Содержимое документов и досок                                                                                    |
| S3 (Yandex Object Storage, локально MinIO)          | Загруженные файлы и изображения                                                                                  |
| Valkey                                              | Очереди задач, pub/sub событий, кеш; постоянных данных нет                                                       |
| IndexedDB в браузере                                | Локальная копия Y.Doc для работы без связи                                                                       |

## 2. PostgreSQL

Общие правила: все `id` — `uuid` версии 7 (сортируются по времени создания); время — `timestamptz`; имена —
snake_case; перечисления — типы `enum` PostgreSQL.

### 2.1. Аккаунты

| Таблица        | Столбцы                                                                                                                                                                                                                   | Назначение                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `users`        | `id`, `email` (citext, уникальный), `email_verified_at`, `password_hash`, `display_name`, `avatar_color`, `is_guest`, `guest_expires_at`, `blocked_at`, `pd_consent_version`, `pd_consent_at`, `created_at`, `deleted_at` | Пользователь, в том числе гость; согласие на обработку персональных данных |
| `sessions`     | `id_hash` (PK), `user_id` → `users`, `created_at`, `expires_at`, `last_seen_at`, `user_agent`, `ip_hash`                                                                                                                  | Сессия; хранится хеш идентификатора, а не он сам                           |
| `email_tokens` | `id`, `user_id`, `purpose` (`verify_email`, `reset_password`), `token_hash`, `expires_at`, `used_at`                                                                                                                      | Одноразовые ссылки из писем                                                |

### 2.2. Пространства

| Таблица       | Столбцы                                                                                                                                                                                        | Назначение                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `workspaces`  | `id`, `name`, `kind` (`personal`, `team`), `plan` (`student`, `team`, `org`, `guest`), `university`, `owner_id`, `is_demo_template`, `demo_clone_of`, `expires_at`, `created_at`, `deleted_at` | Пространство команды; демо-шаблон и его гостевые копии |
| `memberships` | `workspace_id`, `user_id`, `role` (`owner`, `editor`, `viewer`), `created_at`; PK (`workspace_id`, `user_id`)                                                                                  | Участие и роль                                         |
| `invites`     | `id`, `workspace_id`, `email`, `role`, `token_hash`, `max_uses`, `uses`, `created_by`, `expires_at`, `revoked_at`, `created_at`                                                                | Приглашения по почте и по ссылке                       |
| `audit_log`   | `id`, `workspace_id`, `actor_id`, `action`, `target`, `meta` (jsonb), `created_at`                                                                                                             | Журнал действий с участниками и настройками            |

### 2.3. Страницы и их содержимое

| Таблица          | Столбцы                                                                                                                                                                           | Назначение                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `pages`          | `id`, `workspace_id`, `parent_id` → `pages`, `kind` (`document`, `board`), `title`, `icon`, `position`, `created_by`, `created_at`, `updated_at`, `archived_at`, `source_file_id` | Узел дерева страниц; `position` — дробный индекс |
| `yjs_documents`  | `page_id` (PK) → `pages`, `state` (bytea), `size_bytes`, `updated_at`                                                                                                             | Полное состояние Y.Doc страницы                  |
| `page_snapshots` | `id`, `page_id`, `state` (bytea), `reason` (`auto`, `before_restore`, `manual`), `created_by`, `created_at`                                                                       | История версий                                   |

### 2.4. Задачи и связи

| Таблица              | Столбцы                                                                                                                                                                                                                                                                                               | Назначение                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `tasks`              | `id`, `workspace_id`, `number`, `title`, `description`, `status` (`draft`, `todo`, `in_progress`, `review`, `done`), `position`, `assignee_id`, `due_date`, `origin` (`manual`, `ai`), `ai_run_id`, `created_by`, `created_at`, `updated_at`, `completed_at`; уникальность (`workspace_id`, `number`) | Задача; `draft` — черновик, предложенный ИИ |
| `workspace_counters` | `workspace_id` (PK), `next_task_number`                                                                                                                                                                                                                                                               | Сквозная нумерация задач в пространстве     |
| `object_links`       | `id`, `workspace_id`, `from_kind`, `from_page_id`, `from_ref`, `to_kind`, `to_page_id`, `to_ref`, `relation` (`source`, `related`, `generated_from`, `mention`), `created_by`, `created_at`, `broken_at`                                                                                              | Ребро графа знаний                          |

`from_kind` и `to_kind` принимают значения `page`, `block`, `board_item`, `task`. Индексы:
(`workspace_id`, `to_kind`, `to_page_id`, `to_ref`) — для обратных ссылок и
(`workspace_id`, `from_kind`, `from_page_id`, `from_ref`) — для исходящих.

### 2.5. Файлы и импорт

| Таблица       | Столбцы                                                                                                                                                                                                                                                | Назначение                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| `files`       | `id`, `workspace_id`, `uploaded_by`, `storage_key`, `original_name`, `mime`, `size_bytes`, `sha256`, `created_at`                                                                                                                                      | Метаданные файла; сам файл — в S3 |
| `import_jobs` | `id`, `workspace_id`, `file_id`, `parent_page_id`, `kind` (`docx`, `pdf`, `markdown`, `notion`), `status` (`queued`, `running`, `done`, `failed`), `progress`, `report` (jsonb), `error`, `structure_after`, `created_by`, `created_at`, `finished_at` | Задача импорта и её отчёт         |

### 2.6. ИИ

| Таблица     | Столбцы                                                                                                                                                                                                                                                                                                          | Назначение                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ai_runs`   | `id`, `workspace_id`, `source_page_ids` (uuid[]), `target_board_id`, `status`, `progress`, `options` (jsonb), `provider`, `model`, `prompt_version`, `input_tokens`, `output_tokens`, `cost_kopecks`, `timings` (jsonb), `graph` (jsonb), `error`, `feedback` (jsonb), `created_by`, `created_at`, `finished_at` | Запуск структурирования: вход, ход, результат, стоимость |
| `llm_cache` | `key` (PK), `provider`, `model`, `prompt_version`, `response` (jsonb), `created_at`                                                                                                                                                                                                                              | Кеш ответов LLM                                          |

Статусы `ai_runs`: `queued`, `segmenting`, `extracting`, `merging`, `layouting`, `writing`, `done`, `failed`,
`cancelled`.

### 2.7. Поиск (создаётся на этапе M8)

| Таблица         | Столбцы                                                                                                                                                                                                                                                                               | Назначение                                   |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `search_chunks` | `id`, `workspace_id`, `page_id`, `kind` (`page_title`, `doc_section`, `board_item`, `task`), `object_ref`, `anchor_block_ids` (text[]), `heading_path`, `title`, `content`, `content_hash`, `tsv` (генерируемый tsvector), `embedding` (vector(256)), `embedding_model`, `updated_at` | Фрагмент текста для поиска                   |
| `qa_logs`       | `id`, `workspace_id`, `user_id`, `question`, `answer`, `cited_chunk_ids` (uuid[]), `search_ms`, `first_token_ms`, `total_ms`, `feedback`, `created_at`                                                                                                                                | Журнал вопросов и ответов с замерами времени |

`tsv` вычисляется из заголовка (вес A) и содержимого (вес B) в конфигурации `russian`. Индексы: HNSW по
`embedding` (`vector_cosine_ops`), GIN по `tsv`, btree (`workspace_id`, `page_id`). Размерность 256 соответствует
эмбеддингам Yandex; смена модели — миграция и полная переиндексация.

### 2.8. Учёт и обратная связь

| Таблица            | Столбцы                                                                                                                                                 | Назначение                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `usage_counters`   | `workspace_id`, `period` (`YYYY-MM`), `ai_structurings`, `ai_questions`, `input_tokens`, `output_tokens`, `cost_kopecks`; PK (`workspace_id`, `period`) | Месячные счётчики для лимитов тарифа  |
| `ai_daily_spend`   | `day` (PK), `cost_kopecks`                                                                                                                              | Суточный расход на ИИ по всей системе |
| `analytics_events` | `id`, `user_id`, `workspace_id`, `name`, `props` (jsonb), `created_at`                                                                                  | События продуктовой аналитики         |
| `feedback`         | `id`, `user_id`, `workspace_id`, `kind` (`general`, `survey_7d`), `rating`, `answers` (jsonb), `text`, `created_at`                                     | Отзывы и опрос на седьмой день        |

### 2.9. Правила

- Миграции только вперёд. Применённая миграция не редактируется; исправление — новой миграцией.
- Мягкое удаление (`deleted_at`, `archived_at`) учитывают функции репозитория в `packages/db`, а не каждый запрос
  вручную.
- SQL пишется только в `packages/db`; исключение — гибридный запрос поиска в `packages/search/src/query.ts`.
- Внешние ключи: содержимое пространства удаляется вместе с ним; страницу с дочерними удалить нельзя; связи
  (`object_links`) на страницы внешних ключей не имеют и переживают их удаление (FR-LINK-4); авторов физически
  удалить нельзя — аккаунт обезличивается (FR-AUTH-6).
- Драйвер PostgreSQL — `pg` (решение от 2026-11-12, см. [ADR 0005](adr/0005-postgres-pgvector-search.md)).

## 3. Y.Doc

Имя документа на сервере совместного редактирования: `page.<pageId>`. Код работает с Y.Doc только через
`packages/doc-model`; там же — миграции структуры по `schemaVersion`.

### 3.1. Документ

```
Y.Doc
├─ XmlFragment "document-store"      содержимое BlockNote
└─ Map "meta"  { schemaVersion: 1 }
```

У каждого блока есть стабильный идентификатор — на него ссылаются связи, задачи и поисковые фрагменты. Спайк M0.6
подтвердил, что идентификаторы не меняются при вставке соседних блоков и при синхронизации. Для блоков из PDF
номер страницы хранится в свойстве блока `sourcePage`.

### 3.2. Доска

```
Y.Doc
├─ Map "items": id → Y.Map
└─ Map "meta" { schemaVersion: 1 }
```

| Группа полей | Поля                                                                                         | У каких элементов                                      |
| ------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Общие        | `id`, `type`, `x`, `y`, `w`, `h`, `rotation`, `z`, `locked`, `createdBy`, `createdAt`        | все                                                    |
| `style`      | `fill`, `stroke`, `strokeWidth`, `fontSize`, `align`, `shape` (`rect`, `ellipse`, `diamond`) | элементы с оформлением                                 |
| `text`       | Y.Text                                                                                       | стикер, фигура, текст, узел карты, подпись соединителя |
| `mindmap`    | `rootId`, `parentId`, `order`, `collapsed`, `side`, `definition`, `importance` (1–3)         | узел интеллект-карты                                   |
| `connector`  | `fromId`, `toId`, `fromPoint`, `toPoint`, `arrowStart`, `arrowEnd`, `dashed`, `relationType` | соединитель                                            |
| `frame`      | `title`                                                                                      | рамка; состав вычисляется по геометрии и не хранится   |
| `image`      | `fileId`                                                                                     | изображение                                            |
| `provenance` | `aiRunId`, `sourceRefs` (массив `{ pageId, blockId }`)                                       | элементы, созданные ИИ                                 |

Типы элементов: `sticky`, `shape`, `text`, `connector`, `mindmap_node`, `frame`, `image`. Порядок по глубине
(`z`) и порядок детей узла карты (`order`) — дробные индексы: перестановка меняет одно значение.

Все изменения одного запуска ИИ записываются одной транзакцией с меткой `ai-run:<id>`, поэтому результат запуска
можно отменить целиком.

### 3.3. Извлечение текста

Для индексации и ИИ `doc-model` отдаёт содержимое в плоском виде:

- документ — список `{ blockId, type, text, headingLevel, sourcePage }`;
- доска — список `{ itemId, type, text, path }`.

## 4. Связь двух хранилищ

Строка `pages` и её Y.Doc создаются вместе и связаны идентификатором страницы. Источник истины для содержимого —
Y.Doc; `search_chunks`, `page_snapshots` и связи вида `mention` — производные и перестраиваются из него на сервере.
Задачи и связи между объектами хранятся в PostgreSQL и ссылаются на блоки и элементы доски парой
«идентификатор страницы + идентификатор внутри Y.Doc» (`*_page_id` и `*_ref`). Если блок или элемент удалён, связь
не стирается, а помечается `broken_at`.
