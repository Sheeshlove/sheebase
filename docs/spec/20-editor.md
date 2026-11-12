# Редактор документов

> Извлечено из `docs/SPEC.md` (разд. 4.4, 7.2, 8.3). Источник истины — SPEC.md; этот файл не редактируется вручную, идентификаторы требований сохранены.

### 4.4. Редактор документов (FR-DOC)

Основа — BlockNote поверх Yjs (раздел 6.2).

| ID | Требование | Приоритет |
|---|---|---|
| FR-DOC-1 | Блоки: абзац, заголовки H1–H3, маркированный, нумерованный и чек-лист, цитата, код, таблица, изображение, разделитель, выноска (callout, собственный блок) | M |
| FR-DOC-2 | Слеш-меню на русском, markdown-сокращения, перетаскивание блоков, форматирование текста, ссылки | M |
| FR-DOC-3 | Совместное редактирование: курсоры и выделения участников с именами и цветами, список присутствующих в шапке | M |
| FR-DOC-4 | Каждый блок имеет стабильный уникальный `id`. При копировании и вставке блоков `id` новых блоков уникальны в пределах документа (проверяется тестом) | M |
| FR-DOC-5 | Якорные ссылки на блок: «Копировать ссылку на блок», переход по `#block-<id>` прокручивает к блоку и подсвечивает его на 2 с | M |
| FR-DOC-6 | Упоминания `@` страниц и задач как inline-элементы; при упоминании создаётся связь в графе (FR-LINK) | S |
| FR-DOC-7 | Значки у блоков, на которые ссылаются задачи или узлы карты; по клику — список связанных объектов | M |
| FR-DOC-8 | Офлайн-режим: правки сохраняются локально (IndexedDB), индикатор «Нет соединения», синхронизация после восстановления без потерь | M |
| FR-DOC-9 | Отмена и повтор только своих изменений | M |
| FR-DOC-10 | Изображения: загрузка вставкой, перетаскиванием и через меню; хранение в S3; ≤ 10 МБ | M |
| FR-DOC-11 | История версий: автоматические снимки (не чаще раза в 30 минут активной работы и при закрытии последней сессии), просмотр снимка и восстановление (восстановление создаёт новый снимок текущего состояния) | S |
| FR-DOC-12 | Экспорт документа в Markdown | S |
| FR-DOC-13 | Для наблюдателя и гостя без прав редактирования редактор в режиме чтения; сервер отклоняет попытки записи | M |
| FR-DOC-14 | Кнопка «Структурировать» в шапке документа (FR-AI) | M |

### 7.2. Схемы Yjs (`packages/doc-model`)

Имя документа в Hocuspocus: `page.<pageId>`.

**Документ:**
```
Y.Doc
├─ XmlFragment "document-store"      # содержимое BlockNote
└─ Map "meta"  { schemaVersion: 1 }
```
Метаданные блоков, импортированных из PDF (номер страницы), хранятся в пропсах блока (`sourcePage`).

**Доска:**
```
Y.Doc
├─ Map "items": id → Y.Map
│    общие поля: id, type ('sticky'|'shape'|'text'|'connector'|'mindmap_node'|'frame'|'image'),
│                x, y, w, h, rotation, z (дробный индекс), locked, createdBy, createdAt
│    style:      { fill, stroke, strokeWidth, fontSize, align, shape: 'rect'|'ellipse'|'diamond' }
│    text:       Y.Text                                   (sticky, shape, text, mindmap_node, connector label)
│    mindmap:    rootId, parentId|null, order (дробный индекс), collapsed, side ('left'|'right'|null),
│                definition (string), importance (1..3)
│    connector:  fromId|null, toId|null, fromPoint, toPoint, arrowStart, arrowEnd, dashed, relationType
│    frame:      title, childIds (вычисляется по геометрии, не хранится)
│    image:      fileId
│    provenance: aiRunId|null, sourceRefs: Array<{ pageId, blockId }>
└─ Map "meta" { schemaVersion: 1 }
```
- Все изменения ИИ-конвейера записываются одной транзакцией с `origin = 'ai-run:<id>'`.
- `packages/doc-model` содержит типизированные функции доступа (`getItem`, `createSticky`, `moveItems`…) и миграции схемы (`migrate(doc)` по `schemaVersion`). Клиент и сервер работают с Y.Doc только через них.
- Извлечение текста для индексации: `extractDocumentBlocks(doc)` → `[{ blockId, type, text, headingLevel, sourcePage }]`, `extractBoardTexts(doc)` → `[{ itemId, type, text, path }]`.

### 8.3. Протокол совместного редактирования

- Клиент получает короткоживущий JWT (5 мин, HS256, секрет `COLLAB_JWT_SECRET`) через `POST /collab/token`. В токене: `sub` (userId), `pageId`, `workspaceId`, `role`.
- Hocuspocus `onAuthenticate`: проверяет подпись, срок, что `documentName === page.<pageId>`, что страница не в архиве и членство актуально (запрос в БД). Для `viewer` и гостя без прав редактирования — `connection.readOnly = true`.
- Провайдер на клиенте обновляет токен до истечения; при `member.changed` клиент переподключается.
- Хранение: `extension-database` → `yjs_documents.state` (полное состояние через `Y.encodeStateAsUpdate`), debounce 2 с, maxDebounce 10 с. После сохранения — задача индексации `index:page` с задержкой 15 с и дедупликацией по `pageId`, и задача снимка для истории версий по правилу FR-DOC-11.
- Awareness: `{ user: { id, name, color }, cursor, selection }`.

---
