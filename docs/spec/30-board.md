# Интерактивная доска

> Извлечено из `docs/SPEC.md` (разд. 4.5, 7.2). Источник истины — SPEC.md; этот файл не редактируется вручную, идентификаторы требований сохранены.

### 4.5. Интерактивная доска (FR-BOARD)

Собственный движок поверх Konva (раздел 6.2). Данные — в Yjs (раздел 7.2).

| ID | Требование | Приоритет |
|---|---|---|
| FR-BOARD-1 | Бесконечный холст: панорамирование (колесо или тачпад, пробел + перетаскивание, средняя кнопка), масштаб 10–400 % (Ctrl + колесо, жесты), «Показать всё» | M |
| FR-BOARD-2 | Инструменты: выделение, стикер (8 цветов), фигуры (прямоугольник, эллипс, ромб), текст, соединитель, узел карты, рамка; горячие клавиши для каждого | M |
| FR-BOARD-3 | Выделение кликом, рамкой, Shift-кликом; перемещение, изменение размера, удаление, дублирование, копирование и вставка (в том числе между досками), порядок слоёв | M |
| FR-BOARD-4 | Редактирование текста в стикерах, фигурах, узлах (двойной клик), совместное посимвольно (`Y.Text`) | M |
| FR-BOARD-5 | Соединители: прямые с наконечниками, крепятся к элементам и следуют за ними при перемещении; подпись к соединителю | M |
| FR-BOARD-6 | Интеллект-карта: узлы с `parentId`; Tab — дочерний узел, Enter — соседний, сворачивание ветки, перетаскивание ветки к другому родителю, кнопка «Выровнять карту» (тот же алгоритм раскладки, что на сервере) | M |
| FR-BOARD-7 | Узел карты, созданный ИИ, хранит ссылки на блоки-источники; значок источника, по клику — список фрагментов с переходом | M |
| FR-BOARD-8 | Присутствие: курсоры участников с именами, подсветка выделенных ими элементов | M |
| FR-BOARD-9 | Отмена и повтор только своих изменений | M |
| FR-BOARD-10 | Офлайн-режим как в FR-DOC-8 | M |
| FR-BOARD-11 | Создание задачи из элемента доски («Сделать задачей»): задача связана с элементом | M |
| FR-BOARD-12 | Изображения на доске (≤ 10 МБ) | S |
| FR-BOARD-13 | Миникарта | C |
| FR-BOARD-14 | Экспорт видимой области или выделения в PNG | S |
| FR-BOARD-15 | Режим только чтения для наблюдателя и гостя без прав, курсоры при этом видны | M |
| FR-BOARD-16 | Производительность — NFR-PERF-4 | M |

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
