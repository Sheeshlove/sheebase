# shibase — ШИБЕЙС

Облачная платформа для студенческих проектных команд: документы (BlockNote) + доска (свой движок на Konva)

- задачи в одном графе знаний; ИИ-автоструктурирование и семантический поиск на YandexGPT/GigaChat; CRDT на Yjs.
  Полная спецификация: docs/SPEC.md, по модулям — docs/spec/. План: docs/PLAN.md. Прогресс: docs/STATUS.md.
  Каталог prototype/ — прототип первой итерации (справочный, в монорепозиторий не входит, не менять без просьбы).

## Перед началом работы

1. Прочитай docs/STATUS.md и следующую задачу в docs/PLAN.md.
2. Прочитай только нужные разделы docs/spec/.
3. Задача затрагивает больше трёх файлов или новую библиотеку — сначала план.

## Команды

- pnpm infra:up / infra:down — postgres, valkey, minio, mailpit
- pnpm dev — все приложения
- pnpm verify — lint + typecheck + test:unit + test:int (обязательно перед коммитом)
- pnpm test:e2e [--grep @tag] — Playwright (появится с M1.6)
- pnpm db:generate | db:migrate | db:reset (появятся с M1.1)
- pnpm seed:dev | seed:demo (появятся с M1)
- pnpm eval:structuring | eval:search | loadtest:collab | report:pilot (появятся с M7–M10)
- pnpm licenses:check | doctor

## Правила

- TypeScript strict, без any/ts-ignore. ESM, именованные экспорты, файлы ≤ 400 строк.
- Границы: packages не импортируют apps; БД только через packages/db; LLM только через packages/ai/providers;
  Y.Doc только через packages/doc-model; права только через packages/shared/permissions.
- Все строки интерфейса — в apps/web/src/i18n/ru.ts. Название продукта — «ШИБЕЙС», прописными.
- Тесты пишутся вместе с кодом; в названии теста — ID требования (FR-…/NFR-…/KPI-…) или задачи (M…).
- Интеграционные тесты — *.int.test.ts; в тестах LLM_PROVIDER=mock; живые вызовы — только *.live.test.ts.
- Миграции только вперёд; применённые не редактировать.
- Новая зависимость — только из списка docs/spec/90-nfr-infra.md или с подтверждения человека; лицензии — см. там же.
- Запрещено: выдумывать данные оценки и результаты испытаний, править reports/ вручную, ослаблять тесты,
  коммитить секреты, использовать @blocknote/xl-* и tldraw, сторонние SaaS вне РФ.
- Неясно и не критично → самый простой вариант, запись в «Допущения» docs/STATUS.md.
  Критично (см. docs/spec/00-overview.md, «Точки ручного контроля») → остановиться и спросить.

## Завершение задачи

Definition of Done из docs/spec/00-overview.md → обновить STATUS.md и PLAN.md → коммит
`<type>(<scope>): <ID> <описание>`. Push делает человек.
