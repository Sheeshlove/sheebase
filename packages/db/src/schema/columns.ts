import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

// Общие столбцы (docs/SPEC.md, 7.1): id — uuid v7, время — timestamptz.

/** Первичный ключ uuid v7: генерируется приложением, сортируется по времени создания. */
export const id = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
export const createdAt = () => ts('created_at').notNull().defaultNow();

/** Регистронезависимый текст (расширение citext) — для адресов почты. */
export const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/** Двоичные данные — состояние Y.Doc. */
export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => 'bytea',
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});
