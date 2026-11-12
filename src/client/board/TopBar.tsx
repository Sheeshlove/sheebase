import { CircleQuestionMark, Clock3, Download, Eye, MessageSquare, MonitorPlay, PanelLeft } from 'lucide-react';
import { type ReactNode, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '../design/components';
import { Popover } from '../ui/Popover';
import { getUser, subscribeUser, updateUser, USER_COLORS } from '../user';
import { startPresentation } from './actions';
import { commentStats } from './Comments';
import { board } from './controller';
import { exportJson, exportPng, exportSvg, importJsonFile } from './exporter';
import { TimerWidget, VotingMenu } from './Facilitation';
import { getState, type Panel, setState, showToast, useBoard, writePref } from './store';

function BoardName() {
  const meta = useBoard((s) => s.meta);
  const [editing, setEditing] = useState(false);
  if (!meta) return <div className="board-name">Загрузка</div>;
  if (editing) {
    return (
      <input
        className="field board-name-input"
        autoFocus
        defaultValue={meta.name}
        maxLength={120}
        aria-label="Название доски"
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

/** Состояние соединения — словом на заливке (метка Tag), а не одним цветом. */
function Status() {
  const status = useBoard((s) => s.status);
  const map = {
    connecting: ['ПОДКЛЮЧЕНИЕ', 'medium', 'Подключение к серверу'],
    online: ['В СЕТИ', 'low', 'Изменения сохраняются и видны участникам'],
    offline: ['НЕТ СВЯЗИ', 'high', 'Нет связи. Изменения отправятся после подключения. Нажмите, чтобы подключиться'],
    error: ['ОШИБКА', 'high', 'Не удалось открыть доску'],
  } as const;
  const [word, tone, hint] = map[status];
  return (
    <button
      type="button"
      className={`sb-tag sb-tag--${tone} status-tag`}
      title={hint}
      data-testid="status"
      data-status={status}
      onClick={() => status === 'offline' && board.reconnectNow()}
    >
      {word}
    </button>
  );
}

function Me() {
  const user = useSyncExternalStore(subscribeUser, getUser);
  return (
    <Popover
      placement="bottom"
      className="align-right"
      trigger={(_o, toggle) => (
        <button type="button" className="avatar me" style={{ background: user.color }} title={`${user.name} (вы)`} aria-label="Открыть профиль" onClick={toggle}>
          {user.name.slice(0, 1).toUpperCase()}
        </button>
      )}
    >
      {() => (
        <div className="me-panel">
          <label className="field-label">
            Ваше имя
            <input
              className="field"
              defaultValue={user.name}
              maxLength={40}
              onBlur={(e) => updateUser({ name: e.target.value })}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <div className="me-colors" role="group" aria-label="Цвет курсора">
            {USER_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch small ${c === user.color ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => updateUser({ color: c })}
                aria-label={`Выбрать цвет ${c}`}
                aria-pressed={c === user.color}
              />
            ))}
          </div>
          <div className="hint">Участники сразу видят новое имя и цвет</div>
          <button type="button" className="chip" onClick={() => board.summon()} data-testid="summon">
            Собрать всех ко мне
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
              style={{ background: p.color }}
              title={p.name}
              aria-label={`Участник ${p.name}`}
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
                  Перестать следовать
                </button>
              ) : (
                <button type="button" className="list-item" onClick={() => (close(), board.follow(p.clientId))} data-testid="follow">
                  Следовать за участником
                </button>
              )}
              <button type="button" className="list-item" disabled={!p.cursor} onClick={() => (close(), p.cursor && board.centerOn(p.cursor))}>
                Перейти к курсору
              </button>
            </div>
          )}
        </Popover>
      ))}
      {list.length > 6 && (
        <div className="avatar more" title={`Ещё участников: ${list.length - 6}`}>
          +{list.length - 6}
        </div>
      )}
      <Me />
    </div>
  );
}

function PanelButton({ panel, title, icon, badge, unread, testId }: { panel: Panel; title: string; icon: ReactNode; badge?: number; unread?: boolean; testId?: string }) {
  const active = useBoard((s) => s.panel === panel);
  return (
    <button
      type="button"
      className={`icon-btn with-badge ${active ? 'active' : ''}`}
      title={unread ? `${title}. Есть новые сообщения` : title}
      aria-label={title}
      aria-pressed={active}
      onClick={() => setState({ panel: getState().panel === panel ? null : panel })}
      data-testid={testId}
    >
      {icon}
      {!!badge && <span className={`count-badge ${unread ? 'unread' : ''}`}>{badge}</span>}
    </button>
  );
}

function CommentsButton() {
  // пересчитывается при изменении комментариев и отметок о прочтении
  useBoard((s) => s.comments);
  useBoard((s) => s.seen);
  const { open, unread } = commentStats();
  return <PanelButton panel="comments" title="Показать комментарии" icon={<MessageSquare size={20} />} badge={open} unread={unread} testId="comments-button" />;
}

/** Переключатель в меню: включённое состояние — белая «таблетка», как у активного пункта боковой панели. */
function Toggle({ label, value, onChange, testId }: { label: string; value: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={value} className={`list-item ${value ? 'active' : ''}`} onClick={() => onChange(!value)} data-testid={testId}>
      <span>{label}</span>
      <span className="toggle-state">{value ? 'Вкл' : 'Выкл'}</span>
    </button>
  );
}

function ViewMenu() {
  const showAuthors = useBoard((s) => s.showAuthors);
  const showResolved = useBoard((s) => s.showResolved);
  const showMinimap = useBoard((s) => s.showMinimap);
  const showGrid = useBoard((s) => s.showGrid);
  return (
    <Popover
      placement="bottom"
      className="align-right"
      trigger={(_o, open) => (
        <button type="button" className="icon-btn" title="Настроить вид" aria-label="Настроить вид" onClick={open} data-testid="view-menu">
          <Eye size={20} />
        </button>
      )}
    >
      {() => (
        <div className="list wide" role="menu">
          <div className="list-title">Вид</div>
          <Toggle
            label="Авторы стикеров"
            value={showAuthors}
            onChange={(v) => {
              setState({ showAuthors: v });
              writePref('showAuthors', v);
            }}
            testId="toggle-authors"
          />
          <Toggle label="Решённые комментарии" value={showResolved} onChange={(v) => setState({ showResolved: v })} />
          <Toggle label="Мини-карта" value={showMinimap} onChange={(v) => setState({ showMinimap: v })} />
          <Toggle
            label="Сетка"
            value={showGrid}
            onChange={(v) => {
              setState({ showGrid: v });
              writePref('showGrid', v);
            }}
            testId="toggle-grid"
          />
        </div>
      )}
    </Popover>
  );
}

export function TopBar() {
  const importRef = useRef<HTMLInputElement>(null);
  const sidebarOpen = useBoard((s) => s.sidebarOpen);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      showToast('Ссылка на доску скопирована');
    } catch {
      window.prompt('Скопируйте ссылку на доску:', location.href);
    }
  };
  const toggleSidebar = () => {
    const v = !getState().sidebarOpen;
    setState({ sidebarOpen: v });
    writePref('sidebarOpen', v);
  };
  return (
    <>
      <div className="topbar-left panel bar" data-ui>
        {!sidebarOpen && (
          <>
            <button type="button" className="icon-btn" title="Показать список досок" aria-label="Показать список досок" onClick={toggleSidebar} data-testid="sidebar-toggle">
              <PanelLeft size={20} />
            </button>
            <a className="logo" href="#/" aria-label="ШИБЕЙС. Перейти ко всем доскам">
              ШИБЕЙС
            </a>
          </>
        )}
        <BoardName />
        <Status />
      </div>
      <div className="topbar-right panel bar" data-ui>
        <Peers />
        <TimerWidget />
        <VotingMenu />
        <CommentsButton />
        <PanelButton panel="versions" title="Показать историю версий" icon={<Clock3 size={20} />} testId="versions-button" />
        <button
          type="button"
          className="icon-btn hide-narrow"
          title="Показать презентацию"
          aria-label="Показать презентацию"
          onClick={() => startPresentation(0)}
          data-testid="present-button"
        >
          <MonitorPlay size={20} />
        </button>
        <ViewMenu />
        <Popover
          placement="bottom"
          className="align-right"
          trigger={(_o, toggle) => (
            <button type="button" className="icon-btn" title="Экспортировать или импортировать" aria-label="Экспортировать или импортировать" onClick={toggle} data-testid="export-menu">
              <Download size={20} />
            </button>
          )}
        >
          {(close) => (
            <div className="list wide">
              <div className="list-title">Выделение или вся доска</div>
              <button type="button" className="list-item" onClick={() => (close(), void exportPng())} data-testid="export-png">
                Экспортировать в PNG
              </button>
              <button type="button" className="list-item" onClick={() => (close(), void exportSvg())}>
                Экспортировать в SVG
              </button>
              <button type="button" className="list-item" onClick={() => (close(), exportJson())}>
                Сохранить копию в JSON
              </button>
              <button type="button" className="list-item" onClick={() => (close(), importRef.current?.click())}>
                Загрузить JSON на доску
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
        <button type="button" className="icon-btn hide-narrow" title="Показать горячие клавиши" aria-label="Показать горячие клавиши" onClick={() => setState({ showHelp: true })}>
          <CircleQuestionMark size={20} />
        </button>
        <Button variant="accent" onClick={() => void share()} data-testid="share">
          Поделиться
        </Button>
      </div>
    </>
  );
}
