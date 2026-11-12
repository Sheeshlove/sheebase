---
name: new-endpoint
description: Добавить маршрут API: схема в shared, маршрут, права, тесты, OpenAPI.
---

1. Схемы запроса и ответа — Zod в `packages/shared`.
2. Маршрут в `apps/api` с этими схемами.
3. Проверка прав через `packages/shared/permissions` по матрице из docs/spec/10-auth-workspaces.md.
4. Тесты `*.int.test.ts`: успешный сценарий, ошибки валидации, 401 и 403 для каждой роли без доступа. В названиях — ID требований.
5. Обнови OpenAPI (`pnpm api:openapi`).
6. Клиентский вызов — хук TanStack Query в `apps/web`.
