---
name: finish-task
description: Проверить Definition of Done, обновить STATUS.md и PLAN.md, сделать коммит.
---

1. Пройди чек-лист Definition of Done из docs/spec/00-overview.md по пунктам; невыполненное назови прямо.
2. Вызови субагента `reviewer` на diff и исправь замечания.
3. Добавь запись в docs/STATUS.md: сделано, не сделано, тесты, следующее; новые допущения и блокеры — в свои разделы.
4. Отметь задачу в docs/PLAN.md.
5. Новые зависимости: `pnpm licenses:check`, упоминание в итоге задачи.
6. Коммит: `<type>(<scope>): <ID> <описание>`. Push делает человек.
