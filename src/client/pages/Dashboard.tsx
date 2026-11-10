import { Copy, Ellipsis, Pencil, Plus, Search, Trash } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { TEMPLATES } from '../../shared/templates';
import type { BoardMeta } from '../../shared/types';
import { api } from '../api';
import { Popover } from '../ui/Popover';
import { getUser, subscribeUser, updateUser, USER_COLORS } from '../user';

const TEMPLATE_PREVIEW: Record<string, string[]> = {
  blank: [],
  retro: ['#b2f2bb', '#ffc9c9', '#a5d8ff'],
  kanban: ['#fef3a6', '#ffd8a8', '#e5dbff', '#c8f2c2'],
  brainstorm: ['#ffec99', '#fcc2d7', '#c5dcff', '#c8f2c2'],
  mindmap: ['#d0bfff', '#a5d8ff', '#b2f2bb', '#ffd8a8'],
};

function formatDate(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? `сегодня, ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

function plural(n: number, forms: [string, string, string]) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

function UserBadge() {
  const user = useSyncExternalStore(subscribeUser, getUser);
  return (
    <div className="user-badge">
      <span className="avatar" style={{ background: user.color }}>
        {user.name.slice(0, 1).toUpperCase()}
      </span>
      <input
        className="user-name-input"
        defaultValue={user.name}
        maxLength={40}
        aria-label="Ваше имя"
        title="Ваше имя видят другие участники"
        onBlur={(e) => updateUser({ name: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <div className="me-colors">
        {USER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch small ${c === user.color ? 'active' : ''}`}
            style={{ background: c }}
            aria-label={`Цвет ${c}`}
            onClick={() => updateUser({ color: c })}
          />
        ))}
      </div>
    </div>
  );
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
    document.title = 'Мои доски — Sheebase Board';
    void load();
  }, []);

  const create = async (template: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const meta = await api.createBoard({ template });
      location.hash = `#/b/${meta.id}`;
    } catch {
      setError('Не удалось создать доску');
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (boards ?? []).filter((b) => !q || b.name.toLowerCase().includes(q));
  }, [boards, query]);

  return (
    <div className="dashboard">
      <header className="dash-header">
        <div className="brand">
          <div className="logo-mark">S</div>
          <span>Sheebase Board</span>
        </div>
        <UserBadge />
      </header>

      <main className="dash-main">
        <section>
          <h2>Создать доску</h2>
          <div className="templates">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                type="button"
                className="template-card"
                onClick={() => create(t.id)}
                disabled={busy}
                data-testid={`template-${t.id}`}
              >
                <div className={`template-preview ${t.id}`}>
                  {t.id === 'blank' ? (
                    <Plus size={32} />
                  ) : (
                    TEMPLATE_PREVIEW[t.id].map((c, i) => <span key={i} style={{ background: c }} />)
                  )}
                </div>
                <div className="template-name">{t.name}</div>
                <div className="template-desc">{t.description}</div>
              </button>
            ))}
          </div>
        </section>

        <section>
          <div className="section-head">
            <h2>Все доски {boards && <span className="count">{boards.length}</span>}</h2>
            <label className="search">
              <Search size={16} />
              <input placeholder="Поиск по названию" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
          </div>
          {error && <div className="error-box">{error}</div>}
          {!boards && !error && <div className="muted">Загрузка…</div>}
          {boards && filtered.length === 0 && (
            <div className="empty">{boards.length ? 'Ничего не найдено' : 'Пока нет ни одной доски — создайте первую из шаблона выше.'}</div>
          )}
          <div className="board-grid">
            {filtered.map((b) => (
              <div key={b.id} className="board-card" data-testid="board-card">
                <a href={`#/b/${b.id}`} className="board-thumb" aria-label={`Открыть ${b.name}`}>
                  <span>{b.name.slice(0, 1).toUpperCase()}</span>
                </a>
                <div className="board-info">
                  {renaming === b.id ? (
                    <input
                      autoFocus
                      className="rename-input"
                      defaultValue={b.name}
                      maxLength={120}
                      onFocus={(e) => e.target.select()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      onBlur={async (e) => {
                        const name = e.target.value.trim();
                        setRenaming(null);
                        if (name && name !== b.name) {
                          await api.renameBoard(b.id, name).catch(() => setError('Не удалось переименовать'));
                          void load();
                        }
                      }}
                    />
                  ) : (
                    <a href={`#/b/${b.id}`} className="board-title">
                      {b.name}
                    </a>
                  )}
                  <div className="board-meta">
                    {formatDate(b.updatedAt)} · {b.itemCount ?? 0} {plural(b.itemCount ?? 0, ['объект', 'объекта', 'объектов'])}
                  </div>
                </div>
                <Popover
                  className="align-right"
                  trigger={(_o, toggle) => (
                    <button type="button" className="icon-btn" onClick={toggle} aria-label="Действия с доской">
                      <Ellipsis size={18} />
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
                        <Pencil size={16} /> Переименовать
                      </button>
                      <button
                        type="button"
                        className="list-item"
                        onClick={async () => {
                          close();
                          await api.duplicateBoard(b.id).catch(() => setError('Не удалось дублировать'));
                          void load();
                        }}
                      >
                        <Copy size={16} /> Дублировать
                      </button>
                      <button
                        type="button"
                        className="list-item danger"
                        onClick={async () => {
                          close();
                          if (!window.confirm(`Удалить доску «${b.name}»? Это действие нельзя отменить.`)) return;
                          await api.deleteBoard(b.id).catch(() => setError('Не удалось удалить'));
                          void load();
                        }}
                      >
                        <Trash size={16} /> Удалить
                      </button>
                    </div>
                  )}
                </Popover>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
