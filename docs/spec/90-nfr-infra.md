# НФТ, архитектура, данные, API, испытания, инфраструктура, право

> Извлечено из `docs/SPEC.md` (разд. 5–8, 11–14, прил. B). Источник истины — SPEC.md; этот файл не редактируется вручную, идентификаторы требований сохранены.

## 5. Нефункциональные требования

### 5.1. Метрики из заявки (обязательны для отчёта)

Методики измерения — раздел 11. Значения ниже — критерии приёмки.

| ID | Метрика из заявки | Операционное определение | Порог |
|---|---|---|---|
| KPI-1 | Одновременное редактирование одной доски или документа — не менее 30 участников | 30 клиентов одновременно подключены к одной странице и вносят правки 120 с; в конце состояния всех клиентов идентичны; ошибок соединения нет | ≥ 30 |
| KPI-2 | Задержка синхронизации — не более 300 мс | Время от локального изменения у клиента A до применения у клиента B, 95-й перцентиль по всем парам при нагрузке KPI-1 | p95 ≤ 300 мс |
| KPI-3 | Интеллект-карта по документу до 30 страниц — не более 60 с | Время от нажатия «Структурировать» до появления карты на доске для каждого из 10 документов объёмом 25–30 страниц (≈ 500 слов на страницу) с боевым провайдером LLM | максимум ≤ 60 с |
| KPI-4 | Полнота выделения ключевых понятий — не менее 70 % на 50 учебных текстах | Доля понятий экспертной разметки, найденных среди узлов карты (правила сопоставления — 9.8), средняя по 50 текстам (macro) | ≥ 0,70 |
| KPI-5 | Время ответа семантического поиска — не более 3 с | p95 времени от запроса до выдачи результатов поиска на 200 запросах. Для режима «Спросить» дополнительно: p95 времени до первого фрагмента ответа ≤ 3 с | p95 ≤ 3 с |
| KPI-6 | Доля релевантных результатов в первой пятёрке — не менее 80 % на 200 запросах | Основное определение: доля запросов, у которых в топ-5 есть хотя бы один релевантный результат (Hit@5). Дополнительно в отчёт: P@5, MRR@10, nDCG@5. **Определение утвердить до этапа M8, вопрос 17.3** | ≥ 0,80 |
| KPI-7 | Опытная эксплуатация — не менее 10 команд и 100 пользователей | Определения «активной команды» и «пользователя пилота» — 11.7 | ≥ 10 и ≥ 100 |

### 5.2. Производительность (NFR-PERF)

| ID | Требование |
|---|---|
| NFR-PERF-1 | API: p95 ≤ 300 мс для чтения и ≤ 500 мс для записи на стенде (раздел 13.2) при 50 одновременных пользователях |
| NFR-PERF-2 | Первая загрузка приложения: основной JS-бандл ≤ 400 КБ gzip; редактор и доска загружаются лениво. LCP ≤ 2,5 с на десктопе при 50 Мбит/с |
| NFR-PERF-3 | Открытие документа на 50 страниц ≤ 2 с, доски на 1 000 элементов ≤ 2 с |
| NFR-PERF-4 | Доска на 2 000 элементов: панорамирование и масштаб ≥ 50 к/с на ноутбуке уровня Intel i5 11-го поколения со встроенной графикой (отсечение невидимых элементов, кеширование слоёв) |
| NFR-PERF-5 | Раскладка интеллект-карты на 500 узлов ≤ 50 мс |
| NFR-PERF-6 | Сервер совместного редактирования держит 300 одновременных соединений на 200 страницах на одной ВМ 4 vCPU / 8 ГБ |

### 5.3. Надёжность (NFR-REL)

| ID | Требование |
|---|---|
| NFR-REL-1 | Доступность в период пилота ≥ 99 % в месяц (без плановых работ в 01:00–05:00 МСК) |
| NFR-REL-2 | Резервное копирование PostgreSQL ежедневно, хранение 30 дней, версионирование бакета S3. RPO ≤ 24 ч, RTO ≤ 4 ч. Еженедельная автоматическая проверка восстановления |
| NFR-REL-3 | Ни одна подтверждённая сервером правка Yjs не теряется при перезапуске сервера (сохранение с debounce ≤ 2 с, max ≤ 10 с, плюс сохранение при остановке процесса) |
| NFR-REL-4 | Фоновые задачи идемпотентны и повторяются (до 3 попыток с экспоненциальной задержкой); упавшие задачи видны в админке |
| NFR-REL-5 | Отказ провайдера LLM не ломает остальной сервис; при отказе основного провайдера запрос уходит на резервный (YandexGPT ↔ GigaChat) |

### 5.4. Безопасность (NFR-SEC)

| ID | Требование |
|---|---|
| NFR-SEC-1 | Пароли — Argon2id (параметры OWASP). Токены писем и сессий хранятся только в виде SHA-256-хеша |
| NFR-SEC-2 | CSRF: cookie SameSite=Lax + проверка заголовка `Origin` для всех изменяющих запросов |
| NFR-SEC-3 | Заголовки безопасности: строгий CSP без `unsafe-inline` для скриптов, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors 'none' |
| NFR-SEC-4 | Ограничение частоты: вход 10/мин с IP и 5/мин на email, регистрация 5/ч с IP, сброс пароля 3/ч на email, API в целом 300/мин на пользователя |
| NFR-SEC-5 | Авторизация на каждом эндпоинте и при подключении к серверу совместного редактирования через единый модуль `permissions` (Приложение E); тест на каждую пару роль × действие |
| NFR-SEC-6 | Загрузки: проверка сигнатуры, размера, санитизация имён, приватный бакет, выдача по подписанным ссылкам на 5 мин, `Content-Disposition: attachment` для всего, кроме изображений |
| NFR-SEC-7 | Пользовательский HTML и Markdown (импорт, ответы LLM) проходит санитизацию; ответы LLM рендерятся как Markdown без сырого HTML, ссылки — только внутренние |
| NFR-SEC-8 | Защита от prompt injection: содержимое документов передаётся модели как данные в разделителях, системная инструкция запрещает следовать инструкциям из данных; у модели нет инструментов; вывод проверяется по схеме |
| NFR-SEC-9 | Секреты только в переменных окружения; `.env` в `.gitignore`; в репозитории `.env.example`. Сканирование секретов в CI (gitleaks) |
| NFR-SEC-10 | Зависимости: `pnpm audit --prod` в CI (high и critical блокируют сборку), проверка лицензий (раздел 14.2) |
| NFR-SEC-11 | Логи без ПД: email маскируется (`i***@mail.ru`), содержимое документов и вопросов в логи не пишется |
| NFR-SEC-12 | Подготовить чек-лист для внешнего аудита ИБ (по смете 30 000 руб.): `docs/security/checklist.md` по OWASP ASVS уровня 1 |

### 5.5. Персональные данные и 152-ФЗ (NFR-PD)

| ID | Требование |
|---|---|
| NFR-PD-1 | Все данные (БД, S3, бэкапы, логи) — в дата-центрах на территории РФ (Yandex Cloud, регион `ru-central1`) |
| NFR-PD-2 | Собираются только email, отображаемое имя, хеш пароля, технические данные (IP — в виде хеша, user agent). Цели обработки перечислены в политике |
| NFR-PD-3 | Согласие на обработку ПД — отдельный документ и отдельный чекбокс; версия и время фиксируются; при новой версии согласие запрашивается заново |
| NFR-PD-4 | Передача текстов в YandexGPT и GigaChat описывается в политике как поручение обработки; для YandexGPT передаётся заголовок отключения логирования запросов на стороне провайдера (`x-data-logging-enabled: false` — сверить с актуальной документацией) |
| NFR-PD-5 | Удаление аккаунта (FR-AUTH-6) удаляет ПД в течение 24 ч, включая журналы вопросов; бэкапы очищаются по истечении срока хранения |
| NFR-PD-6 | Журналы вопросов к поиску хранятся 90 дней |
| NFR-PD-7 | Организационные меры (уведомление Роскомнадзора об обработке ПД, приказы, назначение ответственного) — на стороне ООО, вне репозитория; в `docs/legal/pd-checklist.md` — перечень для юриста |

### 5.6. Совместимость, интерфейс, доступность (NFR-UX)

| ID | Требование |
|---|---|
| NFR-UX-1 | Браузеры: две последние версии Chrome, Яндекс Браузера, Firefox, Safari, Edge. Десктоп от 1280 px; на мобильных — чтение документов и задач (C) |
| NFR-UX-2 | Интерфейс полностью на русском; все строки в `apps/web/src/i18n/ru.ts`, без строк в коде компонентов (проверяется правилом линтера) |
| NFR-UX-3 | Доступность: управление с клавиатуры для основных действий, видимый фокус, контраст по WCAG 2.1 AA, `aria`-подписи у иконок-кнопок |
| NFR-UX-4 | Если команда положит в `docs/design/` экспорт макетов Figma (PNG и токены), интерфейс делается по ним; иначе — нейтральная система на shadcn/ui с токенами в одном месте |
| NFR-UX-5 | Пустые состояния с подсказкой следующего шага на всех списках; ошибки — человеческим языком, с действием |
| NFR-UX-6 | Тёмная тема | C |

### 5.7. Наблюдаемость (NFR-OBS)

| ID | Требование |
|---|---|
| NFR-OBS-1 | Структурированные JSON-логи (pino) с `requestId`, `userId` (UUID), `workspaceId` |
| NFR-OBS-2 | Метрики Prometheus на `/metrics` (только во внутренней сети): HTTP-задержки, соединения Yjs, длина очередей, длительность и стоимость ИИ-вызовов, ошибки провайдеров |
| NFR-OBS-3 | Prometheus и Grafana в профиле `monitoring` docker compose, дашборд в репозитории; оповещения в Telegram-бот при недоступности, ошибках 5xx > 2 %, исчерпании бюджета ИИ | S |
| NFR-OBS-4 | Ошибки фронтенда отправляются на собственный эндпоинт `/api/v1/client-errors` (без сторонних SaaS) |

---

## 6. Архитектура

### 6.1. Схема

```
                ┌─────────────── Браузер ────────────────┐
                │ apps/web (React SPA)                    │
                │  ├─ BlockNote + Yjs ──┐                 │
                │  ├─ Доска (Konva)+Yjs ┼─ y-indexeddb    │
                │  └─ TanStack Query    │                 │
                └──────┬────────────────┼─────────────────┘
                REST + SSE│        WebSocket│(Yjs)
                ┌────────▼───┐   ┌────────▼────────┐
  Caddy (TLS) → │ apps/api   │   │ apps/collab     │
                │ Fastify    │   │ Hocuspocus      │
                └──┬───┬───┬─┘   └──┬──────────┬───┘
                   │   │   │        │          │ onStoreDocument →
                   │   │   └────────┼──────────┼──► Valkey (очереди BullMQ, pub/sub, кеш)
                   │   │            │          │          ▲
                   ▼   ▼            ▼          │          │
            PostgreSQL 17 + pgvector  ◄────────┘   ┌──────┴───────┐
            S3 (Yandex Object Storage / MinIO) ◄───│ apps/worker  │──► YandexGPT / GigaChat
                                                   │ импорт, ИИ,  │
                                                   │ индексация,  │
                                                   │ очистка      │
                                                   └──────────────┘
```

### 6.2. Стек (решения приняты, альтернативы не рассматриваются без ADR)

| Слой | Выбор | Почему |
|---|---|---|
| Язык | TypeScript везде (strict) | Один язык для клиента, сервера, ИИ-конвейера и общих схем; Yjs и BlockNote — экосистема JS; Claude Code проще держать один стек. Вызовы LLM — обычный HTTP, Python не нужен |
| Рантайм | Node.js 24 LTS | Текущая LTS-линия |
| Пакеты | pnpm (workspaces) + Turborepo | Монорепозиторий, кеш сборок |
| Фронтенд | React 19, Vite, React Router (режим библиотеки), TanStack Query, Zustand, Tailwind CSS 4, shadcn/ui (Radix), lucide-react, dnd-kit | Распространённый стек, хорошо знаком агенту |
| Редактор | BlockNote (`@blocknote/core`, `@blocknote/react`, `@blocknote/shadcn`, `@blocknote/server-util`) | Блочный редактор из коробки, стабильные id блоков, Yjs, серверное преобразование Markdown/HTML ↔ блоки ↔ Y.Doc. **Запрещены пакеты `@blocknote/xl-*`** (лицензия GPL или коммерческая) |
| Доска | Собственный движок (`packages/board-engine`) с рендерингом через Konva + react-konva | Собственная разработка для программы для ЭВМ; tldraw не подходит по лицензии |
| CRDT | Yjs, y-indexeddb, y-protocols | Стандарт де-факто |
| Сервер синхронизации | Hocuspocus Server (`@hocuspocus/server`, `extension-database`, `extension-redis` — для масштабирования, C) + `@hocuspocus/provider` на клиенте | Аутентификация, хуки хранения, режим только чтения |
| API | Fastify 5 + `fastify-type-provider-zod`, OpenAPI через `@fastify/swagger` | Быстро, типобезопасно, документация из схем |
| Валидация | Zod (схемы в `packages/shared`) | Одни схемы на клиенте и сервере |
| БД | PostgreSQL 17 + pgvector (образ `pgvector/pgvector:pg17`); встроенная конфигурация FTS `russian` | Векторный и полнотекстовый поиск в одной БД |
| ORM и миграции | Drizzle ORM + drizzle-kit (SQL-миграции генерируются и коммитятся) | Типобезопасность, прозрачный SQL, поддержка pgvector |
| Очереди и кеш | Valkey 8 + BullMQ | Valkey — BSD-лицензия, совместим с Redis |
| Объектное хранилище | S3 API: MinIO локально, Yandex Object Storage на проде; `@aws-sdk/client-s3` | — |
| Почта | nodemailer, SMTP; локально Mailpit | — |
| Разбор файлов | mammoth (DOCX), unpdf (PDF), fflate (zip), file-type (сигнатуры), papaparse (CSV) | Лицензии MIT/BSD |
| Порядок элементов | `fractional-indexing` | Перестановки без пересчёта |
| Идентификаторы | UUIDv7 (пакет `uuid`) | Сортируемы по времени |
| Хеширование паролей | `@node-rs/argon2` | — |
| LLM и эмбеддинги | YandexGPT 5 Pro / Lite и эмбеддинги Yandex `text-search-doc` / `text-search-query` (основной провайдер); GigaChat 2 (резервный) | Российские провайдеры, оплата в рублях |
| Логи и метрики | pino, prom-client | — |
| Тесты | Vitest, Playwright, собственные скрипты нагрузки и оценки | — |
| Линтеры | ESLint (flat config, typescript-eslint), Prettier, `eslint-plugin-boundaries` для границ модулей | — |
| Сайт | Astro (статический) | Быстрый статический лендинг |
| Прокси и TLS | Caddy 2 | Автоматический TLS |
| CI/CD | GitHub Actions (если хостинг кода другой — вопрос 17.5) | — |
| Реестр образов | Yandex Container Registry | — |

**Версии:** при инициализации берутся актуальные стабильные версии и фиксируются в `pnpm-lock.yaml`; диапазоны в `package.json` — с `^` только в пределах major. Обновление major — отдельная задача.

### 6.3. Структура монорепозитория

```
shibase/
├─ CLAUDE.md                    # инструкции для Claude Code (Приложение A)
├─ .claude/                     # настройки, правила, навыки, субагенты Claude Code (разд. 15)
├─ apps/
│  ├─ web/                      # SPA
│  ├─ api/                      # REST + SSE
│  ├─ collab/                   # Hocuspocus
│  ├─ worker/                   # BullMQ: import, ai, index, maintenance
│  └─ site/                     # лендинг (Astro)
├─ packages/
│  ├─ shared/                   # zod-схемы, типы, константы, permissions, plans, analytics events
│  ├─ db/                       # drizzle-схема, миграции, клиент, репозитории
│  ├─ doc-model/                # схемы Y.Doc документа и доски, чтение и запись, извлечение текста, миграции схем
│  ├─ board-engine/             # ядро доски: сцена, инструменты, hit-test, рендер Konva, undo
│  ├─ layout/                   # раскладка интеллект-карты, измерение текста (чистый TS, без DOM)
│  ├─ ai/                       # провайдеры LLM, промпты, конвейер структурирования
│  ├─ search/                   # чанкинг, индексация, гибридный запрос, RAG
│  ├─ importers/                # docx, pdf, md, notion → блоки
│  ├─ templates/                # шаблоны страниц (Markdown + описание)
│  ├─ testing/                  # фабрики, фикстуры, мок-провайдеры, хелперы для БД
│  └─ config/                   # eslint, tsconfig, prettier, vitest presets
├─ tools/
│  ├─ loadtest/                 # нагрузочный тест совместного редактирования (KPI-1, KPI-2)
│  ├─ eval/                     # оценка структурирования и поиска (KPI-3…6)
│  ├─ reports/                  # генератор протоколов испытаний и отчёта по пилоту
│  ├─ rospatent/                # сборка листинга для заявки на программу для ЭВМ
│  └─ spikes/                   # одноразовые прототипы для проверки библиотек
├─ data/
│  └─ eval/                     # датасеты оценки (разд. 9.8, 10.7)
├─ reports/                     # сгенерированные протоколы (коммитятся)
├─ infra/
│  ├─ docker-compose.yml        # dev: postgres, valkey, minio, mailpit
│  ├─ docker-compose.prod.yml   # prod: все сервисы + caddy (+ профиль monitoring)
│  ├─ Caddyfile
│  ├─ docker/                   # Dockerfile для каждого приложения
│  ├─ certs/                    # корневой сертификат НУЦ Минцифры (кладёт человек)
│  └─ scripts/                  # backup, restore-test, deploy
└─ docs/
   ├─ SPEC.md                   # этот документ
   ├─ spec/                     # он же, разбитый по модулям
   ├─ PLAN.md                   # этапы и задачи с чекбоксами
   ├─ STATUS.md                 # журнал прогресса, допущения, блокеры
   ├─ adr/                      # архитектурные решения
   ├─ architecture.md           # результат работы 2.1 для отчёта
   ├─ data-model.md             # спецификация модели данных для отчёта
   ├─ api.md                    # ссылка на OpenAPI + протокол WS и SSE
   ├─ security/  legal/  design/  user-guide/
```

**Границы модулей (проверяются `eslint-plugin-boundaries`):**
- `packages/*` не импортируют `apps/*`.
- `layout`, `doc-model`, `shared` не зависят от Node- и DOM-специфичных API (работают и в браузере, и на сервере).
- `board-engine` не знает о React (React-обвязка — в `apps/web/src/features/board`).
- Доступ к БД — только через `packages/db`; SQL в других пакетах запрещён, кроме `packages/search/src/query.ts` (гибридный запрос).
- Вызовы LLM — только через интерфейсы `packages/ai/src/providers`.

### 6.4. ADR

Формат `docs/adr/NNNN-название.md`: контекст, решение, альтернативы, последствия. На этапе M0 оформить ADR 0001–0008 по решениям из 6.2 (язык, редактор, движок доски, CRDT-сервер, БД и поиск, очереди, провайдеры LLM, хостинг). Любое отступление от этого документа — новый ADR и запись в `docs/STATUS.md`.

---

## 7. Модель данных

### 7.1. PostgreSQL

Все `id` — `uuid` (v7), время — `timestamptz`, имена — snake_case. Перечисления — PostgreSQL `enum` через Drizzle `pgEnum`. Ниже логическая схема; точная — в `packages/db/src/schema/*.ts`.

```
users(id, email citext unique, email_verified_at, password_hash, display_name, avatar_color,
      is_guest bool, guest_expires_at, blocked_at, pd_consent_version, pd_consent_at,
      created_at, deleted_at)
sessions(id_hash text pk, user_id → users, created_at, expires_at, last_seen_at, user_agent, ip_hash)
email_tokens(id, user_id, purpose enum(verify_email, reset_password), token_hash, expires_at, used_at)

workspaces(id, name, kind enum(personal, team), plan enum(student, team, org, guest),
           university text null, owner_id, is_demo_template bool, demo_clone_of uuid null,
           expires_at null, created_at, deleted_at)
memberships(workspace_id, user_id, role enum(owner, editor, viewer), created_at, pk(workspace_id, user_id))
invites(id, workspace_id, email null, role, token_hash, max_uses, uses, created_by, expires_at, revoked_at, created_at)

pages(id, workspace_id, parent_id null → pages, kind enum(document, board), title, icon,
      position text, created_by, created_at, updated_at, archived_at, source_file_id null)
yjs_documents(page_id pk → pages, state bytea, size_bytes int, updated_at)
page_snapshots(id, page_id, state bytea, reason enum(auto, before_restore, manual), created_by null, created_at)

tasks(id, workspace_id, number int, title, description, status enum(draft, todo, in_progress, review, done),
      position text, assignee_id null, due_date date null, origin enum(manual, ai), ai_run_id null,
      created_by, created_at, updated_at, completed_at)
      unique(workspace_id, number)
workspace_counters(workspace_id pk, next_task_number int)

object_links(id, workspace_id,
             from_kind enum(page, block, board_item, task), from_page_id null, from_ref text,
             to_kind   enum(page, block, board_item, task), to_page_id null,   to_ref text,
             relation enum(source, related, generated_from, mention),
             created_by null, created_at, broken_at null)
      index(workspace_id, to_kind, to_page_id, to_ref), index(workspace_id, from_kind, from_page_id, from_ref)

files(id, workspace_id, uploaded_by, storage_key, original_name, mime, size_bytes, sha256, created_at)
import_jobs(id, workspace_id, file_id, parent_page_id null, kind enum(docx, pdf, markdown, notion),
            status enum(queued, running, done, failed), progress real, report jsonb, error text,
            structure_after bool, created_by, created_at, finished_at)

ai_runs(id, workspace_id, source_page_ids uuid[], target_board_id, status enum(queued, segmenting,
        extracting, merging, layouting, writing, done, failed, cancelled), progress real,
        options jsonb, provider, model, prompt_version, input_tokens, output_tokens, cost_kopecks,
        timings jsonb, graph jsonb, error text, feedback jsonb, created_by, created_at, finished_at)
llm_cache(key text pk, provider, model, prompt_version, response jsonb, created_at)

search_chunks(id, workspace_id, page_id null, kind enum(page_title, doc_section, board_item, task),
              object_ref text, anchor_block_ids text[], heading_path text, title, content,
              content_hash, tsv tsvector GENERATED ALWAYS AS (setweight(to_tsvector('russian', coalesce(title,'')), 'A')
                                                          || setweight(to_tsvector('russian', content), 'B')) STORED,
              embedding vector(256), embedding_model, updated_at)
      index HNSW (embedding vector_cosine_ops), GIN(tsv), btree(workspace_id, page_id)
qa_logs(id, workspace_id, user_id, question, answer, cited_chunk_ids uuid[], search_ms, first_token_ms,
        total_ms, feedback smallint null, created_at)

usage_counters(workspace_id, period char(7) 'YYYY-MM', ai_structurings, ai_questions, input_tokens,
               output_tokens, cost_kopecks, pk(workspace_id, period))
ai_daily_spend(day date pk, cost_kopecks)
analytics_events(id, user_id null, workspace_id null, name, props jsonb, created_at)
feedback(id, user_id, workspace_id null, kind enum(general, survey_7d), rating smallint, answers jsonb, text, created_at)
audit_log(id, workspace_id, actor_id, action, target, meta jsonb, created_at)
```

Правила:
- Миграции только вперёд; уже применённую миграцию не редактировать, исправление — новой миграцией.
- Размерность `vector(256)` соответствует эмбеддингам Yandex. Смена модели эмбеддингов — миграция и полная переиндексация (команда `pnpm search:reindex --all`).
- Мягкое удаление (`deleted_at`, `archived_at`) учитывается во всех запросах через функции репозитория, а не вручную.

### 7.3. Права и события в реальном времени

- Модуль `packages/shared/src/permissions.ts`: `can(role, action, context) → boolean`; матрица — Приложение E. API и collab используют только его.
- Поток событий пространства: `GET /api/v1/workspaces/:id/events` (SSE). События: `page.created|updated|moved|archived`, `task.created|updated|deleted`, `member.changed`, `import.progress`, `ai_run.progress`, `link.changed`. Передача между процессами — pub/sub Valkey. Клиент по событиям инвалидирует кеш TanStack Query.

---

## 8. API

### 8.1. Соглашения

- REST, префикс `/api/v1`, JSON, camelCase в JSON.
- Ошибки: `{ "error": { "code": "QUOTA_EXCEEDED", "message": "Лимит структурирований на ноябрь исчерпан", "details": {…} } }`. Коды — перечисление в `packages/shared/src/errors.ts`; сообщения на русском.
- Пагинация курсором: `?cursor=&limit=` → `{ items, nextCursor }`.
- OpenAPI доступна в dev на `/api/docs`; файл `docs/api/openapi.json` генерируется командой `pnpm api:openapi` и коммитится.
- Идемпотентность создания через заголовок `Idempotency-Key` для импорта и запуска ИИ.

### 8.2. Эндпоинты

```
Аутентификация
POST /auth/register  POST /auth/login  POST /auth/logout  POST /auth/logout-all
POST /auth/verify-email  POST /auth/resend-verification
POST /auth/password-reset/request  POST /auth/password-reset/confirm
POST /auth/guest                     GET  /auth/me
PATCH /me   POST /me/password   DELETE /me

Пространства и участники
GET/POST /workspaces          GET/PATCH/DELETE /workspaces/:wid
GET /workspaces/:wid/members  PATCH/DELETE /workspaces/:wid/members/:uid
POST /workspaces/:wid/transfer-ownership
GET/POST /workspaces/:wid/invites   DELETE /workspaces/:wid/invites/:iid
GET /invites/:token (предпросмотр)  POST /invites/:token/accept
GET /workspaces/:wid/usage   GET /workspaces/:wid/summary   GET /workspaces/:wid/audit
GET /workspaces/:wid/events (SSE)

Страницы
GET  /workspaces/:wid/pages (дерево)        POST /workspaces/:wid/pages {kind, title, parentId, templateId?}
PATCH /pages/:pid {title, icon, parentId, position}
POST /pages/:pid/duplicate  POST /pages/:pid/archive  POST /pages/:pid/restore  DELETE /pages/:pid
GET  /pages/:pid/snapshots  POST /pages/:pid/snapshots/:sid/restore
GET  /pages/:pid/export?format=md
GET  /pages/:pid/backlinks
POST /collab/token {pageId} → {token, expiresAt, readOnly}

Задачи и связи
GET  /workspaces/:wid/tasks?status=&assignee=&due=&q=   POST /workspaces/:wid/tasks
GET/PATCH/DELETE /tasks/:tid    POST /tasks/:tid/move {status, beforeId?, afterId?}
POST /workspaces/:wid/tasks/drafts/accept {ids|all}  POST /workspaces/:wid/tasks/drafts/reject {ids}
GET  /me/tasks
GET  /workspaces/:wid/links?endpointKind=&pageId=&ref=   POST /workspaces/:wid/links   DELETE /links/:lid

Файлы и импорт
POST /workspaces/:wid/files (multipart)   GET /files/:fid/url
POST /workspaces/:wid/imports {fileId, parentPageId?, structureAfter}   GET /imports/:id

ИИ
POST /ai/structure {sourcePageIds, targetBoardId?, createTasks, detail: 'compact'|'detailed'}
GET  /ai/runs/:id   POST /ai/runs/:id/cancel   POST /ai/runs/:id/feedback

Поиск
GET  /workspaces/:wid/search?q=&kinds=&limit=
POST /workspaces/:wid/ask {question} → text/event-stream (события: sources, delta, done, error)
POST /qa/:id/feedback

Прочее
POST /feedback   POST /analytics/events (пакетно, только события из списка)   POST /client-errors
GET  /admin/stats  GET /admin/pilot-report  PATCH /admin/workspaces/:wid/plan  POST /admin/users/:uid/block
GET  /healthz  GET /readyz  GET /metrics (внутренняя сеть)
```

## 11. Методики испытаний и протоколы

Все протоколы генерируются скриптами в `reports/` по шаблону: название испытания, дата, SHA коммита, стенд (характеристики ВМ, регион, задержка сети между клиентом и сервером), параметры, сырые результаты (JSON рядом), итог «соответствует / не соответствует» каждому KPI. Протоколы прикладываются к заключительному отчёту (работа 2.6). Ручная правка цифр в протоколах запрещена.

### 11.1. KPI-1, KPI-2: совместное редактирование

`pnpm loadtest:collab --url wss://… --page <id> --clients 30 --duration 120 --rate 2 --mode board|document`
- Все клиенты запускаются в одном процессе Node на отдельной ВМ того же региона (общие часы — нет проблемы синхронизации времени). Каждый клиент — `HocuspocusProvider` + `ws`, авторизация тестовыми токенами (`pnpm loadtest:tokens`).
- Операции: доска — перемещение и правка текста случайных элементов (из 300 заранее созданных); документ — вставка и удаление символов в случайных абзацах.
- Измерение: каждая операция дополнительно пишет в `Y.Map "probe"` запись `{clientId, seq, t}`; остальные клиенты при получении записывают `now − t`. Метрики p50, p95, p99, max по всем парам.
- Сходимость: по завершении все клиенты ждут 5 с тишины и сравнивают хеш `Y.encodeStateVector` и текстовое содержимое — должны совпасть у всех.
- Испытание проводится для доски и для документа; дополнительно прогон на 50 клиентах для запаса.

### 11.2. KPI-3: время построения карты

`pnpm eval:structuring --timing --set data/eval/timing` — 10 документов 25–30 страниц (DOCX и PDF), боевой провайдер, кеш LLM отключён. Время — от вызова `POST /ai/structure` до события `ai_run.progress{status: done}` и наличия карты на доске (проверяется чтением Y.Doc). Порог — каждый из 10 ≤ 60 с.

### 11.3. KPI-4

Методика — раздел 9.8.

### 11.4. KPI-5 и KPI-6

Методика — раздел 10.7.

### 11.5. Функциональные испытания

Отчёт Playwright (HTML) по сценариям S1–S7 и e2e-набору 12.4 на стенде `staging`, `pnpm test:e2e --project=staging`. Протокол `reports/functional-YYYY-MM-DD.md` генерируется из JSON-отчёта Playwright.

### 11.6. Производительность и надёжность

- NFR-PERF-1 — сценарий k6 или собственный скрипт `tools/loadtest/api` (50 виртуальных пользователей, 10 мин);
- NFR-PERF-4 — e2e-тест с замером FPS через `requestAnimationFrame` на доске из 2 000 элементов (на CI — только информативно, на эталонном ноутбуке — для протокола);
- NFR-REL-2 — `infra/scripts/restore-test.sh` с отчётом.

### 11.7. KPI-7: опытная эксплуатация

- **Пользователь пилота:** зарегистрированный подтверждённый пользователь (не гость, не из команды проекта — исключаются по `PILOT_EXCLUDE_EMAILS`), который был активен (любое изменяющее действие) хотя бы в 3 разных дня.
- **Активная команда:** командное пространство, где ≥ 3 пользователей пилота и за период пилота создано ≥ 5 страниц или задач, и хотя бы один прогон ИИ или вопрос к материалам.
- Отчёт `pnpm report:pilot --from YYYY-MM-DD --to YYYY-MM-DD` (FR-ADMIN-3) + сводка опросов (FR-ADMIN-5): среднее число сервисов до перехода, оценка времени на первичное структурирование, доля «полезно» по прогонам ИИ и ответам.

---

## 12. Тестирование

### 12.1. Уровни и инструменты

| Уровень | Инструмент | Что покрывает | Где |
|---|---|---|---|
| Unit | Vitest (+ fast-check) | layout, нормализация, чанкинг, RRF, permissions, plans, парсеры, doc-model, утилиты | рядом с кодом: `*.test.ts` |
| Интеграционные | Vitest + реальные PostgreSQL, Valkey, MinIO | маршруты API через `fastify.inject`, collab с двумя клиентами в процессе, воркеры с mock-LLM, изоляция поиска | `*.int.test.ts` |
| E2E | Playwright (Chromium; Firefox и WebKit — ночью) | сценарии 12.4 | `apps/web/e2e/` |
| Живые | Vitest, `LLM_PROVIDER=yandex|gigachat` | контракты провайдеров, регрессия промптов | `*.live.test.ts`, вручную и ночью |
| Оценка и нагрузка | скрипты `tools/` | KPI | раздел 11 |

### 12.2. Требования к покрытию

Строк ≥ 85 % для `packages/layout`, `packages/shared/src/permissions.ts`, `packages/ai/src/pipeline`, `packages/search`; ≥ 70 % для `apps/api`; общее ≥ 65 %. Проверяется в CI.

### 12.3. Правила тестов

- Тесты не ходят в интернет; LLM — mock или replay.
- Время — через `vi.useFakeTimers` или внедряемые часы; случайность — с зафиксированным seed.
- Каждый интеграционный тест работает в своей схеме или транзакции и не зависит от порядка.
- Фабрики данных — в `packages/testing` (`makeUser`, `makeWorkspace`, `makeDocument(blocks)`, `makeBoard(items)`).
- Docker в среде Claude Code может быть недоступен. Тогда интеграционные тесты пропускаются с явным сообщением `SKIPPED: no database`, а агент обязан сообщить об этом в итоге задачи и в `docs/STATUS.md` и не считать задачу выполненной до прогона в CI.

### 12.4. Обязательный E2E-набор

1. Регистрация → письмо в Mailpit (через его API) → подтверждение → личное пространство создано.
2. Создание командного пространства, приглашение по ссылке, вход второго пользователя, смена роли на наблюдателя → редактор у него в режиме чтения.
3. Два контекста браузера правят один документ → тексты совпадают, видны курсоры.
4. Офлайн: `context.setOffline(true)`, правки у обоих, затем онлайн → слияние без потерь.
5. Доска: стикер, фигура, соединитель; перемещение фигуры двигает соединитель; второй пользователь видит изменения.
6. Карта вручную: Tab и Enter создают узлы, «Выровнять карту» убирает пересечения.
7. Импорт DOCX с галочкой «Сразу структурировать» (mock-LLM) → карта и черновики → принять → у задачи ссылка на блок → переход с подсветкой блока.
8. Импорт zip Notion из фикстуры → дерево и внутренние ссылки.
9. Поиск Ctrl+K находит блок документа, элемент доски и задачу; «Спросить» показывает ответ со ссылками.
10. Пользователь другого пространства не находит чужие материалы.
11. Канбан: перетаскивание между колонками; второй пользователь видит изменение ≤ 2 с.
12. Гостевой вход → плашка гостя → лимит структурирований → понятное сообщение.
13. Архив и восстановление страницы; восстановление версии документа.
14. Сайт: на главной есть логотипы и обязательный текст (проверка точного совпадения строки).

---

## 13. Инфраструктура и развёртывание

### 13.1. Локальная разработка

```
pnpm i
cp .env.example .env
pnpm infra:up          # docker compose -f infra/docker-compose.yml up -d (postgres, valkey, minio, mailpit)
pnpm db:migrate
pnpm seed:dev          # тестовые пользователи, пространство, документы
pnpm dev               # turbo: web :5173, api :3000, collab :3001, worker
```
`pnpm doctor` проверяет версии Node и pnpm, доступность сервисов, применённость миграций, наличие переменных окружения и печатает, чего не хватает.

### 13.2. Окружения

| Окружение | Где | Назначение |
|---|---|---|
| dev | ноутбук или среда Claude Code | разработка, LLM — mock |
| ci | GitHub Actions, сервисные контейнеры | проверки |
| staging | ВМ Yandex Cloud 2 vCPU / 4 ГБ, `staging.<домен>` | приёмка задач, e2e, испытания функциональности, LLM — боевой с малым бюджетом |
| prod | ВМ Yandex Cloud 4 vCPU / 8–16 ГБ, SSD 100 ГБ, `app.<домен>`, сайт — `<домен>` | пилот, гостевой доступ, испытания KPI |
| loadtest-client | временная ВМ 2 vCPU в том же регионе | клиенты нагрузочного теста |

Prod на одной ВМ с docker compose: caddy, web (статические файлы через caddy), api, collab, worker, postgres, valkey; S3 — Yandex Object Storage. Управляемая БД — вариант на будущее (ADR 0008), сейчас не по бюджету.

### 13.3. CI/CD

- **PR:** `pnpm install --frozen-lockfile` → `lint` → `typecheck` → `test:unit` → `test:int` (сервисы postgres+pgvector, valkey, minio) → `build` → `test:e2e` (Chromium, mock-LLM) → `licenses:check` → `audit` → gitleaks. Всё должно быть зелёным для слияния.
- **main:** сборка Docker-образов, публикация в Yandex Container Registry, автоматический деплой на staging и миграции.
- **Тег `vX.Y.Z`:** деплой на prod по ручному подтверждению (GitHub Environments), миграции перед переключением, проверка `/readyz`, откат на предыдущий тег скриптом `infra/scripts/rollback.sh`.
- **Ночью:** e2e в Firefox и WebKit, живые тесты провайдеров, `restore-test` (раз в неделю).

### 13.4. Резервные копии

`infra/scripts/backup.sh` (cron на ВМ): `pg_dump -Fc` → шифрование (`age`) → бакет Object Storage в отдельном каталоге с хранением 30 дней. `restore-test.sh` разворачивает последний дамп во временный контейнер и проверяет число строк ключевых таблиц и чтение 10 случайных Y.Doc.

### 13.5. Переменные окружения

Полный список — Приложение B. Валидация при старте каждого приложения через Zod (`packages/shared/src/env.ts`): при ошибке процесс не стартует и печатает список недостающих переменных.

---

## 14. Правовые и регистрационные требования к коду

### 14.1. Программа для ЭВМ (работа 2.8)

- Правообладатель — ООО, созданное в рамках проекта; получатель гранта должен быть среди авторов (договор Фонда).
- **Авторство при работе с ИИ-ассистентом.** По ГК РФ автором признаётся человек, творческим трудом которого создан результат. Значительную часть кода пишет Claude Code под руководством команды, поэтому до подачи заявки нужна консультация юриста (в смете — 10 000 руб.) о том, как описать творческий вклад авторов. Чтобы этот вклад был документирован, в репозитории ведутся: спецификация и ADR (авторские решения людей), описания алгоритмов (9.4–9.6, 10.3) с указанием авторов, история ревью PR людьми, журнал `docs/STATUS.md`. Коммиты, сделанные с участием Claude Code, содержат трейлер `Co-Authored-By`, но автор коммита — человек, который поставил задачу и принял результат.
- `pnpm rospatent:listing` (`tools/rospatent`) собирает фрагменты исходного текста собственных модулей (`packages/board-engine`, `layout`, `ai`, `search`, `doc-model`, `importers`, `apps/*`): без `node_modules`, сгенерированного кода, миграций и тестов; с нумерацией страниц и заголовком. Число страниц и формат — по требованиям Роспатента, параметры уточняет юрист. Также генерируется реферат-заготовка (назначение, функции, язык, объём в КБ, требования к ЭВМ) для правки человеком.
- В `NOTICE.md` (генерируется `pnpm licenses:notice`) — перечень сторонних компонентов с лицензиями.

### 14.2. Лицензии зависимостей

- Разрешены: MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, MPL-2.0, 0BSD, CC0-1.0, Unlicense, BlueOak-1.0.0, Python-2.0 (для транзитивных утилит).
- Запрещены без решения человека: GPL, LGPL, AGPL, SSPL, BUSL, Commons Clause, проприетарные, отсутствие лицензии.
- `pnpm licenses:check` в CI проходит по всему дереву production-зависимостей и падает на запрещённых.

### 14.3. Требования Фонда к публикациям

На сайте, в руководстве пользователя (`docs/user-guide/`) и в разделе «О сервисе» внутри приложения указывается текст о поддержке Фонда (FR-SITE-2).

### 14.4. Документы для отчёта, которые генерируются из репозитория

| Документ | Работа плана | Источник |
|---|---|---|
| Описание архитектуры | 2.1 | `docs/architecture.md` + ADR |
| Спецификация модели данных | 2.1 | `docs/data-model.md` (генерируется из Drizzle-схемы скриптом `pnpm docs:data-model` + ручные пояснения) |
| Протоколы испытаний | 2.2, 2.4, 2.5, 2.6 | `reports/*` |
| Руководство пользователя | 2.7, 2.8 | `docs/user-guide/` (Markdown со скриншотами из Playwright: `pnpm docs:screenshots`) |
| Листинг и реферат для Роспатента | 2.8 | `tools/rospatent` |
| Отчёт по опытной эксплуатации | 2.6 | `pnpm report:pilot` |

---

## Приложение B. Переменные окружения

| Переменная | Пример / по умолчанию | Назначение |
|---|---|---|
| `NODE_ENV` | `development` | |
| `APP_URL` | `http://localhost:5173` | адрес SPA, для писем и CORS |
| `SITE_URL` | `http://localhost:4321` | сайт |
| `API_PORT`, `COLLAB_PORT` | `3000`, `3001` | |
| `DATABASE_URL` | `postgres://shibase:shibase@localhost:5432/shibase` | |
| `VALKEY_URL` | `redis://localhost:6379` | |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | MinIO локально | |
| `SESSION_SECRET` | 64 случайных байта | подпись cookie |
| `COLLAB_JWT_SECRET` | 64 случайных байта | токены collab |
| `SMTP_URL`, `MAIL_FROM` | `smtp://localhost:1025`, `ШИБЕЙС <no-reply@…>` | почта |
| `LLM_PROVIDER` | `mock` | `mock` / `replay` / `yandex` / `gigachat` |
| `LLM_FALLBACK_PROVIDER` | пусто | резервный |
| `EMBEDDING_PROVIDER` | `mock` | `mock` / `yandex` |
| `YANDEX_API_KEY`, `YANDEX_FOLDER_ID` | — | Foundation Models |
| `GIGACHAT_AUTH_KEY`, `GIGACHAT_SCOPE` | —, `GIGACHAT_API_PERS` | |
| `NODE_EXTRA_CA_CERTS` | `/certs/russian_trusted_root_ca.cer` | для GigaChat |
| `AI_MAX_CONCURRENCY` | `6` | |
| `AI_EXTRACT_MODEL`, `AI_ANSWER_MODEL` | `pro`, `lite` | |
| `AI_MERGE_THRESHOLD` | `0.90` | 9.4 |
| `AI_DAILY_BUDGET_RUB` | `500` | FR-PLAN-3 |
| `LLM_RECORD` | `0` | запись фикстур replay |
| `ADMIN_EMAILS` | — | FR-ADMIN-1 |
| `GUEST_ENABLED` | `true` | |
| `GUEST_EXPERT_EMAIL`, `GUEST_EXPERT_PASSWORD` | — | FR-GUEST-3 |
| `GUEST_HOURLY_PER_IP`, `GUEST_DAILY_TOTAL` | `10`, `200` | FR-GUEST-5 |
| `PILOT_EXCLUDE_EMAILS` | — | 11.7 |
| `TELEGRAM_ALERT_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` | — | оповещения |
| `LOG_LEVEL` | `info` | |
