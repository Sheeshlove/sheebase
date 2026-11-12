import { Ellipsis } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { TEMPLATES, buildTemplate } from '../../shared/templates';
import { renderThumbnailSvg } from '../../shared/thumbnail';
import type { BoardMeta, ItemMap } from '../../shared/types';
import { api } from '../api';
import heroUrl from '../design/assets/road-mountain-hero.webp';
import { Button, PageCard, SearchField, Tag } from '../design/components';
import { Sidebar } from '../Sidebar';
import { Popover } from '../ui/Popover';

export function plural(n: number, forms: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

/** «Изменено сегодня», «Изменено вчера», «Изменено 12 нояб.» */
function changed(ts: number) {
  const d = new Date(ts);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(new Date()) - day(d)) / 86_400_000);
  if (diff <= 0) return 'Изменено сегодня';
  if (diff === 1) return 'Изменено вчера';
  return `Изменено ${d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`;
}

const templatePreviews = new Map<string, string>();

/** Превью шаблона — та же миниатюра, что и у досок, построенная из его объектов. */
function templatePreview(id: string): string {
  let url = templatePreviews.get(id);
  if (!url) {
    let n = 0;
    const items: ItemMap = Object.fromEntries(buildTemplate(id, () => `t${n++}`).map((it) => [it.id, it]));
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderThumbnailSvg(items))}`;
    templatePreviews.set(id, url);
  }
  return url;
}

export function Dashboard() {
  const [boards, setBoards] = useState<BoardMeta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listBoards()
      .then((b) => {
        setBoards(b);
        setError(null);
      })
      .catch(() => setError('Сервер недоступен. Проверьте, что он запущен.'));

  useEffect(() => {
    document.title = 'Доски — ШИБЕЙС';
    void load();
  }, []);

  const create = async (template: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const meta = await api.createBoard({ template });
      location.hash = `#/b/${meta.id}`;
    } catch {
      setError('Не удалось создать доску.');
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (boards ?? []).filter((b) => !q || b.name.toLowerCase().includes(q));
  }, [boards, query]);

  return (
    <div className="workspace">
      <Sidebar boards={boards} />
      <main className="workspace-canvas">
        <div className="ws-top">
          <div className="ws-search">
            <SearchField value={query} onChange={setQuery} placeholder="Найти доску" data-testid="board-search" />
          </div>
          <Button variant="accent" onClick={() => void create('blank')} disabled={busy} data-testid="create-board">
            Создать доску
          </Button>
        </div>

        <h1 className="title ws-title">Доски</h1>

        {error && (
          <div className="notice-card" role="alert">
            <Tag tone="high">ОШИБКА</Tag>
            <span>{error}</span>
          </div>
        )}

        <section className="ws-section">
          <div className="section-head">
            <h2 className="subtitle">Все доски</h2>
            {boards && boards.length > 0 && (
              <span className="stat">
                {boards.length} {plural(boards.length, ['доска', 'доски', 'досок'])}
              </span>
            )}
          </div>

          {boards === null && !error && <p className="stat">Загрузка</p>}

          {boards && boards.length === 0 && (
            <div className="empty-state" data-testid="empty-boards">
              <img className="empty-photo" src={heroUrl} alt="" />
              <p className="hero">Здесь пока пусто. Создайте первую доску.</p>
            </div>
          )}

          {boards && boards.length > 0 && filtered.length === 0 && <p className="stat">Ничего не найдено. Измените запрос.</p>}

          <div className="card-grid">
            {filtered.map((b) => {
              const count = b.itemCount ?? 0;
              return (
                <article key={b.id} className="sb-card board-card" data-testid="board-card">
                  <a className="card-preview" href={`#/b/${b.id}`} aria-label={`Открыть доску «${b.name}»`} tabIndex={-1}>
                    {count > 0 && <img src={`/api/boards/${b.id}/thumbnail.svg?v=${b.updatedAt}`} alt="" loading="lazy" data-testid="board-thumbnail" />}
                  </a>
                  {renaming === b.id ? (
                    <input
                      autoFocus
                      className="field rename-input"
                      defaultValue={b.name}
                      maxLength={120}
                      aria-label="Название доски"
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onBlur={async (e) => {
                        const name = e.target.value.trim();
                        setRenaming(null);
                        if (name && name !== b.name) {
                          await api.renameBoard(b.id, name).catch(() => setError('Не удалось переименовать доску.'));
                          void load();
                        }
                      }}
                    />
                  ) : (
                    <h3 className="sb-card__title">
                      <a href={`#/b/${b.id}`} className="board-title">
                        {b.name}
                      </a>
                    </h3>
                  )}
                  <p className="sb-card__excerpt">
                    {count} {plural(count, ['объект', 'объекта', 'объектов'])}
                  </p>
                  <div className="sb-card__foot">
                    <Tag>Доска</Tag>
                    <span className="sb-card__meta">{changed(b.updatedAt)}</span>
                    <Popover
                      className="align-right"
                      trigger={(_o, toggle) => (
                        <button type="button" className="icon-btn" onClick={toggle} aria-label={`Действия с доской «${b.name}»`} title="Действия с доской">
                          <Ellipsis size={20} />
                        </button>
                      )}
                    >
                      {(close) => (
                        <div className="list">
                          <button
                            type="button"
                            className="list-item"
                            onClick={() => {
                              close();
                              setRenaming(b.id);
                            }}
                          >
                            Переименовать
                          </button>
                          <button
                            type="button"
                            className="list-item"
                            onClick={async () => {
                              close();
                              await api.duplicateBoard(b.id).catch(() => setError('Не удалось дублировать доску.'));
                              void load();
                            }}
                          >
                            Дублировать
                          </button>
                          <button
                            type="button"
                            className="list-item"
                            onClick={async () => {
                              close();
                              if (!window.confirm(`Удалить доску «${b.name}»? Это действие нельзя отменить.`)) return;
                              await api.deleteBoard(b.id).catch(() => setError('Не удалось удалить доску.'));
                              void load();
                            }}
                          >
                            Удалить
                          </button>
                        </div>
                      )}
                    </Popover>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <section className="ws-section">
          <h2 className="subtitle">Шаблоны</h2>
          <div className="card-grid compact">
            {TEMPLATES.filter((t) => t.id !== 'blank').map((t) => (
              <PageCard
                key={t.id}
                title={t.name}
                excerpt={t.description}
                onClick={() => void create(t.id)}
                disabled={busy}
                data-testid={`template-${t.id}`}
                preview={
                  <span className="card-preview">
                    <img src={templatePreview(t.id)} alt="" />
                  </span>
                }
              />
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
