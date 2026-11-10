import type { BoardMeta, ItemMap, TemplateInfo } from '../shared/types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const api = {
  listBoards: () => request<BoardMeta[]>('/api/boards'),
  templates: () => request<TemplateInfo[]>('/api/templates'),
  createBoard: (body: { name?: string; template?: string }) =>
    request<BoardMeta>('/api/boards', { method: 'POST', body: JSON.stringify(body) }),
  getBoard: (id: string) => request<{ meta: BoardMeta; items: ItemMap }>(`/api/boards/${id}`),
  renameBoard: (id: string, name: string) =>
    request<BoardMeta>(`/api/boards/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  duplicateBoard: (id: string) => request<BoardMeta>(`/api/boards/${id}/duplicate`, { method: 'POST', body: '{}' }),
  deleteBoard: (id: string) => request<void>(`/api/boards/${id}`, { method: 'DELETE' }),
};
