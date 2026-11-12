import { uid } from '../shared/ops';
import type { UserInfo } from '../shared/types';

const KEY = 'sheebase:user';

export const USER_COLORS = ['#e03131', '#c2255c', '#9c36b5', '#6741d9', '#3b5bdb', '#1971c2', '#0c8599', '#2f9e44', '#e8590c', '#f08c00'];

const ADJECTIVES = ['Смелый', 'Быстрый', 'Мудрый', 'Весёлый', 'Тихий', 'Яркий', 'Хитрый', 'Добрый'];
const ANIMALS = ['Ёж', 'Лис', 'Кот', 'Енот', 'Бобр', 'Филин', 'Барсук', 'Тюлень'];

function randomUser(): UserInfo {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return { id: uid(10), name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`, color: pick(USER_COLORS) };
}

function read(): UserInfo | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw.id === 'string' && typeof raw.name === 'string' && typeof raw.color === 'string') return raw;
  } catch {
    /* хранилище недоступно */
  }
  return null;
}

let current: UserInfo = read() ?? randomUser();
try {
  localStorage.setItem(KEY, JSON.stringify(current));
} catch {
  /* без сохранения */
}

const listeners = new Set<() => void>();

export function getUser(): UserInfo {
  return current;
}

export function updateUser(patch: Partial<Omit<UserInfo, 'id'>>) {
  current = { ...current, ...patch, name: (patch.name ?? current.name).trim().slice(0, 40) || current.name };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* без сохранения */
  }
  for (const l of listeners) l();
}

export function subscribeUser(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
