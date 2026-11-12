# ШИБЕЙС

Облачная платформа для студенческих проектных команд: документы, доска и задачи в одном графе знаний,
ИИ-автоструктурирование и семантический поиск, совместное редактирование.

Репозиторий находится на этапе M0 (фундамент): монорепозиторий, каркасы приложений и проверки готовы,
продуктовых функций ещё нет.

| Что                           | Где                                                                 |
| ----------------------------- | ------------------------------------------------------------------- |
| Техническое задание           | [docs/SPEC.md](docs/SPEC.md), по модулям — [docs/spec/](docs/spec/) |
| План                          | [docs/PLAN.md](docs/PLAN.md)                                        |
| Состояние, допущения, блокеры | [docs/STATUS.md](docs/STATUS.md)                                    |
| Архитектурные решения         | [docs/adr/](docs/adr/)                                              |
| Результаты спайков            | [tools/spikes/README.md](tools/spikes/README.md)                    |
| Прототип первой итерации      | [prototype/](prototype/)                                            |

## Запуск

```bash
pnpm i
cp .env.example .env
pnpm infra:up
pnpm doctor
pnpm dev
```

Проверка перед коммитом: `pnpm verify` (lint, typecheck, unit- и интеграционные тесты).

## Структура

- `apps/` — `web` (SPA), `api` (REST), `collab` (сервер совместного редактирования), `worker` (фоновые задачи), `site` (сайт).
- `packages/` — общие модули: `shared`, `db`, `doc-model`, `board-engine`, `layout`, `ai`, `search`, `importers`,
  `templates`, `testing`, `config`.
- `tools/` — служебные скрипты и спайки. `infra/` — docker compose.
