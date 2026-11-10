import {
  ChevronLeft,
  CircleQuestionMark,
  Clock3,
  Crosshair,
  Download,
  Eye,
  FileBraces,
  FileImage,
  Image,
  Link,
  MessageSquare,
  MonitorPlay,
  Upload,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useRef, useState, useSyncExternalStore } from 'react';
import { Popover } from '../ui/Popover';
import { getUser, subscribeUser, updateUser, USER_COLORS } from '../user';
import { board } from './controller';
import { exportJson, exportPng, exportSvg, importJsonFile } from './exporter';
import { startPresentation } from './actions';
import { commentStats } from './Comments';
import { TimerWidget, VotingMenu } from './Facilitation';
import { getState, type Panel, setState, showToast, useBoard, writePref } from './store';

function BoardName() {
  const meta = useBoard((s) => s.meta);
  const [editing, setEditing] = useState(false);
  if (!meta) return <div className="board-name muted">Загрузка…</div>;
  if (editing) {
    return (
      <input
        className="board-name-input"
        autoFocus
        defaultValue={meta.name}
        maxLength={120}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setEditing(false);
        }}
        onBlur={(e) => {
          const name = e.target.value.trim();
          if (name && name !== meta.name) board.rename(name);
          setEditing(false);
        }}
      />
    );
  }
  return (
    <button type="button" className="board-name" title="Переименовать доску" onClick={() => setEditing(true)} data-testid="board-name">
      {meta.name}
    </button>
  );
}

function Status() {
  const status = useBoard((s) => s.status);
  const map = {
    connecting: ['Подключение…', 'status-wait'],
    online: ['Онлайн', 'status-ok'],
    offline: ['Нет связи — изменения сохранятся после переподключения', 'status-bad'],
    error: ['Ошибка', 'status-bad'],
  } as const;
  const [label, cls] = map[status];
  return (
    <button
      type="button"
      className={`status ${cls}`}
      title={label}
      data-testid="status"
      data-status={status}
      onClick={() => status === 'offline' && board.reconnectNow()}
    >
      {status === 'offline' || status === 'error' ? <WifiOff size={16} /> : <Wifi size={16} />}
      {status !== 'online' && <span className="status-text">{status === 'offline' ? 'Офлайн' : label}</span>}
    </button>
  );
}

function Me() {
  const user = useSyncExternalStore(subscribeUser, getUser);
  return (
    <Popover
      placement="bottom"
      trigger={(_o, toggle) => (
        <button type="button" className="avatar me" style={{ background: user.color }} title={`${user.name} (вы)`} onClick={toggle}>
          {user.name.slice(0, 1).toUpperCase()}
        </button>
      )}
    >
      {() => (
        <div className="me-panel">
          <label>
            Ваше имя
            <input
              defaultValue={user.name}
              maxLength={40}
              onBlur={(e) => updateUser({ name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          </label>
          <div className="me-colors">
            {USER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch ${c === user.color ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => updateUser({ color: c })}
                aria-label={c}
              />
            ))}
          </div>
          <div className="hint">Коллеги сразу видят новое имя и цвет</div>
          <button type="button" className="chip" onClick={() => board.summon()} data-testid="summon">
            <Users size={14} /> Собрать всех ко мне
          </button>
        </div>
      )}
    </Popover>
  );
}

function Peers() {
  const peers = useBoard((s) => s.peers);
  const following = useBoard((s) => s.following);
  const list = Object.values(peers);
  return (
    <div className="avatars" data-testid="peers" data-count={list.length}>
      {list.slice(0, 6).map((p) => (
        <Popover
          key={p.clientId}
          placement="bottom"
          className="align-right"
          trigger={(_o, toggle) => (
            <button
              type="button"
              className={`avatar ${following === p.clientId ? 'followed' : ''}`}
              style={{ background: p.color, outlineColor: p.color }}
              title={p.name}
              onClick={toggle}
              data-testid="peer-avatar"
            >
              {p.name.slice(0, 1).toUpperCase()}
            </button>
          )}
        >
          {(close) => (
            <div className="list">
              <div className="list-title">{p.name}</div>
              {following === p.clientId ? (
                <button type="button" className="list-item" onClick={() => (close(), board.stopFollowing())}>
                  <Eye size={16} /> Перестать следовать
                </button>
              ) : (
                <button type="button" className="list-item" onClick={() => (close(), board.follow(p.clientId))} data-testid="follow">
                  <Eye size={16} /> Следовать за видом
                </button>
              )}
              <button type="button" className="list-item" disabled={!p.cursor} onClick={() => (close(), p.cursor && board.centerOn(p.cursor))}>
                <Crosshair size={16} /> Перейти к курсору
              </button>
            </div>
          )}
        </Popover>
      ))}
      {list.length > 6 && <div className="avatar more">+{list.length - 6}</div>}
      <Me />
    </div>
  );
}

function PanelButton({ panel, title, icon, badge, dot, testId }: { panel: Panel; title: string; icon: React.ReactNode; badge?: number; dot?: boolean; testId?: string }) {
  const active = useBoard((s) => s.panel === panel);
  return (
    <button
      type="button"
      className={`icon-btn with-badge ${active ? 'active' : ''}`}
      title={title}
      aria-label={title}
      onClick={() => setState({ panel: getState().panel === panel ? null : panel })}
      data-testid={testId}
    >
      {icon}
      {!!badge && <span className="count-badge">{badge}</span>}
      {dot && <span className="dot-unread" />}
    </button>
  );
}

function CommentsButton() {
  // пересчитывается при изменении комментариев и отметок о прочтении
  useBoard((s) => s.comments);
  useBoard((s) => s.seen);
  const { open, unread } = commentStats();
  return <PanelButton panel="comments" title="Комментарии" icon={<MessageSquare size={18} />} badge={open} dot={unread} testId="comments-button" />;
}

function ViewMenu() {
  const showAuthors = useBoard((s) => s.showAuthors);
  const showResolved = useBoard((s) => s.showResolved);
  const showMinimap = useBoard((s) => s.showMinimap);
  const toggle = (label: string, value: boolean, onChange: (v: boolean) => void, testId?: string) => (
    <label className="check-row" data-testid={testId}>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
  return (
    <Popover
      placement="bottom"
      className="align-right"
      trigger={(_o, open) => (
        <button type="button" className="icon-btn" title="Вид" onClick={open} data-testid="view-menu">
          <Eye size={18} />
        </button>
      )}
    >
      {() => (
        <div className="menu-panel">
          <div className="list-title">Вид</div>
          {toggle(
            'Показывать авторов стикеров',
            showAuthors,
            (v) => {
              setState({ showAuthors: v });
              writePref('showAuthors', v);
            },
            'toggle-authors',
          )}
          {toggle('Показывать решённые комментарии', showResolved, (v) => setState({ showResolved: v }))}
          {toggle('Мини-карта', showMinimap, (v) => setState({ showMinimap: v }))}
        </div>
      )}
    </Popover>
  );
}

export function TopBar() {
  const importRef = useRef<HTMLInputElement>(null);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      showToast('Ссылка на доску скопирована');
    } catch {
      window.prompt('Скопируйте ссылку на доску:', location.href);
    }
  };
  return (
    <>
      <div className="topbar-left panel" data-ui>
        <a className="icon-link" href="#/" title="Ко всем доскам" aria-label="Ко всем доскам">
          <ChevronLeft size={20} />
        </a>
        <div className="logo-mark" aria-hidden>
          S
        </div>
        <BoardName />
        <Status />
      </div>
      <div className="topbar-right panel" data-ui>
        <Peers />
        <div className="sep-v" />
        <TimerWidget />
        <VotingMenu />
        <CommentsButton />
        <PanelButton panel="versions" title="История версий" icon={<Clock3 size={18} />} testId="versions-button" />
        <button type="button" className="icon-btn hide-narrow" title="Презентация фреймов" onClick={() => startPresentation(0)} data-testid="present-button">
          <MonitorPlay size={18} />
        </button>
        <ViewMenu />
        <Popover
          placement="bottom"
          className="align-right"
          trigger={(_o, toggle) => (
            <button type="button" className="icon-btn" title="Экспорт и импорт" onClick={toggle} data-testid="export-menu">
              <Download size={18} />
            </button>
          )}
        >
          {(close) => (
            <div className="list">
              <div className="list-title">Экспорт (выделение или вся доска)</div>
              <button type="button" className="list-item" onClick={() => (close(), void exportPng())} data-testid="export-png">
                <Image size={16} /> Изображение PNG
              </button>
              <button type="button" className="list-item" onClick={() => (close(), exportSvg())}>
                <FileImage size={16} /> Вектор SVG
              </button>
              <button type="button" className="list-item" onClick={() => (close(), exportJson())}>
                <FileBraces size={16} /> Бэкап JSON
              </button>
              <div className="list-title">Импорт</div>
              <button type="button" className="list-item" onClick={() => (close(), importRef.current?.click())}>
                <Upload size={16} /> Загрузить JSON на доску
              </button>
            </div>
          )}
        </Popover>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importJsonFile(f);
            e.target.value = '';
          }}
        />
        <button type="button" className="icon-btn" title="Горячие клавиши (?)" onClick={() => setState({ showHelp: true })}>
          <CircleQuestionMark size={18} />
        </button>
        <button type="button" className="primary-btn" onClick={share} data-testid="share">
          <Link size={16} /> Поделиться
        </button>
      </div>
    </>
  );
}
