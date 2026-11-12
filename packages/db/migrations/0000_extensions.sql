-- Расширения, которые нужны схеме: citext — регистронезависимая почта (users.email, invites.email).
-- drizzle-kit расширения не создаёт, поэтому это пользовательская миграция (generate --custom).
CREATE EXTENSION IF NOT EXISTS citext;
