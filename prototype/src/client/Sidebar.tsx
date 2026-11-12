import { PanelLeftClose } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { BoardMeta } from '../shared/types';
import { api } from './api';
import { SidebarItem } from './design/components';
import { getUser, subscribeUser, updateUser, USER_COLORS } from './user';

/** Профиль участника внизу боковой панели: имя и цвет курсора. */
function Profile() {
  const user = useSyncExternalStore(subscribeUser, getUser);
  return (
    <div className="sidebar-profile">
      <div className="profile-row">
        <span className="avatar" style={{ background: user.color }} aria-hidden>
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <input
          key={user.name}
          className="field"
          defaultValue={user.name}
          maxLength={40}
          aria-label="Ваше имя"
          title="Имя видят другие участники"
          onBlur={(e) => updateUser({ name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="me-colors" role="group" aria-label="Цвет курсора">
        {USER_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`swatch small ${c === user.color ? 'active' : ''}`}
            style={{ background: c }}
            aria-label={`Выбрать цвет ${c}`}
            aria-pressed={c === user.color}
            onClick={() => updateUser({ color: c })}
          />
        ))}
      </div>
    </div>
  );
}

interface SidebarProps {
  /** Открытая доска (на странице доски). */
  currentId?: string | null;
  /** Её актуальное название — меняется на лету при переименовании. */
  currentName?: string;
  /** Уже загруженный список (дашборд). Если не передан, панель загрузит его сама. */
  boards?: BoardMeta[] | null;
  /** Скрыть панель (на странице доски). */
  onClose?: () => void;
}

/**
 * Боковая панель ШИБЕЙС: логотип, дерево рабочего пространства из SidebarItem
 * на фоне blue-700, профиль. Ширина 260px.
 */
export function Sidebar({ currentId = null, currentName, boards: given, onClose }: SidebarProps) {
  const [own, setOwn] = useState<BoardMeta[] | null>(null);
  const external = given !== undefined;
  useEffect(() => {
    if (external) return;
    let alive = true;
    api
      .listBoards()
      .then((b) => alive && setOwn(b))
      .catch(() => alive && setOwn([]));
    return () => {
      alive = false;
    };
  }, [external, currentId]);
  const boards = (external ? given : own) ?? [];

  return (
    <aside className="sidebar deep" data-ui data-testid="sidebar">
      <div className="sidebar-head">
        <a className="logo" href="#/" aria-label="ШИБЕЙС. Перейти ко всем доскам">
          ШИБЕЙС
        </a>
        {onClose && (
          <button type="button" className="icon-btn" title="Скрыть список досок" aria-label="Скрыть список досок" onClick={onClose}>
            <PanelLeftClose size={20} />
          </button>
        )}
      </div>
      <nav className="sidebar-nav" aria-label="Доски">
        <SidebarItem label="Все доски" active={!currentId} count={boards.length} onClick={() => (location.hash = '#/')} />
        {boards.slice(0, 50).map((b) => (
          <SidebarItem
            key={b.id}
            depth={1}
            label={b.id === currentId && currentName ? currentName : b.name}
            active={b.id === currentId}
            onClick={() => (location.hash = `#/b/${b.id}`)}
          />
        ))}
      </nav>
      <Profile />
    </aside>
  );
}
