import { useEffect } from 'react';
import { frameOrder } from '../../shared/layout';
import questionUrl from '../design/assets/question.png';
import { Button } from '../design/components';
import { Sidebar } from '../Sidebar';
import {
  alignSelection,
  bringToFront,
  canEditText,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  insertImageFile,
  nudgeSelection,
  pasteText,
  presentationGo,
  redo,
  selectAll,
  sendToBack,
  serializeSelection,
  setSelection,
  setTool,
  startEditing,
  stopPresentation,
  toggleLock,
  undo,
  ungroupSelection,
  zoomToSelection,
} from './actions';
import { Canvas, interactions } from './Canvas';
import { CommentDraft, CommentsPanel, ThreadCard } from './Comments';
import { ContextMenu } from './ContextMenu';
import { ContextToolbar } from './ContextToolbar';
import { board } from './controller';
import { FollowFrame, FollowLabel, ResultsPanel, VotingBanner } from './Facilitation';
import { FramesPanel, PresentationBar, PresentationMask } from './FramesPanel';
import { HelpDialog, Toast } from './HelpDialog';
import { NavControls } from './NavControls';
import { closeSearch, openSearch, SearchBar } from './SearchBar';
import { getState, setState, type Tool, useBoard, votingActive, writePref } from './store';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';
import { VersionsPanel } from './VersionsPanel';

function isEditable(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

const TOOL_KEYS: Record<string, Tool> = {
  KeyV: 'select',
  KeyH: 'hand',
  KeyN: 'sticky',
  KeyT: 'text',
  KeyS: 'shape',
  KeyL: 'connector',
  KeyP: 'pen',
  KeyE: 'eraser',
  KeyF: 'frame',
  KeyC: 'comment',
};

/** Клавиши режима презентации. */
function presentationKeys(e: KeyboardEvent) {
  const st = getState();
  const n = frameOrder(st.items).length;
  const i = st.presenting!.index;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
    case 'Enter':
      presentationGo(i + 1);
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
    case 'Backspace':
      presentationGo(i - 1);
      break;
    case 'Home':
      presentationGo(0);
      break;
    case 'End':
      presentationGo(n - 1);
      break;
    case 'Escape':
      stopPresentation();
      break;
    default:
      return;
  }
  e.preventDefault();
}

/** Навигация, доступная всегда (в том числе во время голосования). Возвращает true, если клавиша обработана. */
function navigationKeys(e: KeyboardEvent, mod: boolean): boolean {
  const st = getState();
  const code = e.code;
  if (mod) {
    if (code === 'Equal' || code === 'NumpadAdd') board.zoomAt(st.camera.zoom * 1.25);
    else if (code === 'Minus' || code === 'NumpadSubtract') board.zoomAt(st.camera.zoom / 1.25);
    else if (code === 'Digit0') board.zoomAt(1);
    else return false;
    e.preventDefault();
    return true;
  }
  if (e.altKey) return false;
  if (e.shiftKey && code === 'Digit1') return void board.zoomToFit(), true;
  if (e.shiftKey && code === 'Digit0') return void board.zoomAt(1), true;
  if (e.shiftKey && code === 'Digit2') return void zoomToSelection(), true;
  if (e.key === '?' || (e.shiftKey && code === 'Slash')) return void setState({ showHelp: true }), true;
  if (e.key === '+' || e.key === '=') return void board.zoomAt(st.camera.zoom * 1.25), true;
  if (e.key === '-' || e.key === '_') return void board.zoomAt(st.camera.zoom / 1.25), true;
  return false;
}

function onKeyDown(e: KeyboardEvent) {
  if (isEditable(e.target)) return;
  const st = getState();
  if (!st.loaded) return;
  const mod = e.ctrlKey || e.metaKey;
  const code = e.code;

  if (st.showHelp) {
    if (e.key === 'Escape') setState({ showHelp: false });
    return;
  }
  if (st.presenting) return presentationKeys(e);

  if (mod && code === 'KeyF') {
    e.preventDefault();
    openSearch();
    return;
  }
  if (code === 'Space') {
    e.preventDefault();
    if (!st.spacePan) setState({ spacePan: true });
    return;
  }
  if (e.key === 'Escape') {
    if (st.contextMenu) setState({ contextMenu: null });
    else if (interactions?.active) interactions.cancel();
    else if (st.commentDraft) setState({ commentDraft: null });
    else if (st.openThreadId) setState({ openThreadId: null });
    else if (st.search.open) closeSearch();
    else if (st.following) board.stopFollowing();
    else if (st.tool !== 'select') setTool('select');
    else setSelection([]);
    return;
  }
  if (navigationKeys(e, mod)) return;
  // во время голосования доска «заморожена»: только навигация
  if (votingActive(st)) return;

  if (mod) {
    let handled = true;
    switch (code) {
      case 'KeyZ':
        if (e.shiftKey) redo();
        else undo();
        break;
      case 'KeyY':
        redo();
        break;
      case 'KeyA':
        selectAll();
        break;
      case 'KeyD':
        duplicateSelection();
        break;
      case 'KeyG':
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
        break;
      case 'KeyL':
        if (e.shiftKey) toggleLock();
        else handled = false;
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
    return;
  }

  // выравнивание: Alt+A/D/W/S/H/V, распределение: Alt+Shift+H/V
  if (e.altKey) {
    const align: Record<string, () => void> = e.shiftKey
      ? { KeyH: () => distributeSelection('x'), KeyV: () => distributeSelection('y') }
      : {
          KeyA: () => alignSelection('left'),
          KeyD: () => alignSelection('right'),
          KeyW: () => alignSelection('top'),
          KeyS: () => alignSelection('bottom'),
          KeyH: () => alignSelection('hcenter'),
          KeyV: () => alignSelection('vmiddle'),
        };
    const fn = align[code];
    if (fn && st.selection.length > 1) {
      e.preventDefault();
      fn();
    }
    return;
  }

  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      deleteSelection();
      return;
    case 'Enter': {
      if (st.selection.length === 1 && canEditText(st.items[st.selection[0]])) {
        e.preventDefault();
        startEditing(st.selection[0]);
      }
      return;
    }
    case 'ArrowLeft':
    case 'ArrowRight':
    case 'ArrowUp':
    case 'ArrowDown': {
      if (!st.selection.length) return;
      e.preventDefault();
      const d = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0;
      const dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      nudgeSelection(dx, dy);
      return;
    }
    case 'PageUp':
      e.preventDefault();
      bringToFront();
      return;
    case 'PageDown':
      e.preventDefault();
      sendToBack();
      return;
  }

  if (e.shiftKey) return;
  if (code === 'KeyR' || code === 'KeyO') {
    setState({ shapeKind: code === 'KeyR' ? 'rect' : 'ellipse' });
    setTool('shape');
    return;
  }
  const tool = TOOL_KEYS[code];
  if (tool) setTool(tool);
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space' && getState().spacePan) setState({ spacePan: false });
}

function onCopy(e: ClipboardEvent, cut = false) {
  if (isEditable(e.target) || !getState().selection.length || getState().presenting) return;
  const data = serializeSelection();
  if (!data || !e.clipboardData) return;
  e.clipboardData.setData('text/plain', data);
  e.preventDefault();
  if (cut && !votingActive()) deleteSelection();
}

function onPaste(e: ClipboardEvent) {
  const st = getState();
  if (isEditable(e.target) || !st.loaded || !e.clipboardData || st.presenting || votingActive(st)) return;
  const images = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'));
  e.preventDefault();
  if (images.length) {
    images.slice(0, 10).forEach((f) => void insertImageFile(f, board.pointer ?? undefined));
    return;
  }
  pasteText(e.clipboardData.getData('text/plain'));
}

/** Кнопки интерфейса не забирают фокус (иначе Пробел/Enter нажимали бы их повторно). */
function keepFocus(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (t.closest?.('button') && !t.closest('input, textarea')) e.preventDefault();
}

function SidePanel() {
  const panel = useBoard((s) => s.panel);
  switch (panel) {
    case 'comments':
      return <CommentsPanel />;
    case 'frames':
      return <FramesPanel />;
    case 'versions':
      return <VersionsPanel />;
    case 'results':
      return <ResultsPanel />;
    default:
      return null;
  }
}

export function BoardPage({ id }: { id: string }) {
  const loaded = useBoard((s) => s.loaded);
  const status = useBoard((s) => s.status);
  const error = useBoard((s) => s.error);
  const name = useBoard((s) => s.meta?.name);
  const presenting = useBoard((s) => !!s.presenting);
  const sidebarOpen = useBoard((s) => s.sidebarOpen);
  const panelOpen = useBoard((s) => s.panel !== null);

  useEffect(() => {
    board.open(id);
    return () => board.close();
  }, [id]);

  useEffect(() => {
    document.title = name ? `${name} — ШИБЕЙС` : 'ШИБЕЙС';
  }, [name]);

  useEffect(() => {
    const copy = (e: ClipboardEvent) => onCopy(e);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const blur = () => setState({ spacePan: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', blur);
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', onPaste);
    document.addEventListener('mousedown', keepFocus, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', blur);
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('mousedown', keepFocus, true);
    };
  }, []);

  const closeSidebar = () => {
    setState({ sidebarOpen: false });
    writePref('sidebarOpen', false);
  };

  // Раскладка ШИБЕЙС — не больше трёх колонок: боковая панель (blue-700),
  // холст (blue-500) и, когда открыта, белая панель страницы.
  return (
    <div className={`board-page ${presenting ? 'presenting' : ''}`}>
      {sidebarOpen && !presenting && <Sidebar currentId={id} currentName={name} onClose={closeSidebar} />}
      <div className="board-stage">
        <Canvas />
        {presenting ? (
          <>
            <PresentationMask />
            <PresentationBar />
          </>
        ) : (
          <>
            <FollowFrame />
            <TopBar />
            <Toolbar />
            <ContextToolbar />
            {/* плашки по центру сверху — в одном столбце, чтобы не перекрывались */}
            <div className="top-center">
              <FollowLabel />
              <VotingBanner />
              <SearchBar />
            </div>
            <NavControls />
            <ThreadCard />
            <CommentDraft />
            <ContextMenu />
          </>
        )}
        <Toast />
        {!loaded && status !== 'error' && (
          <div className="loading" data-testid="loading">
            <p className="stat">Загрузка доски</p>
          </div>
        )}
        {status === 'error' && (
          <div className="fatal">
            <img src={questionUrl} alt="" width={146} height={146} />
            <h2 className="hero">{error ?? 'Не удалось открыть доску'}</h2>
            <p className="stat">Возможно, доску удалили или ссылка неверна.</p>
            <Button variant="inverse" onClick={() => (location.hash = '#/')}>
              Вернуться к доскам
            </Button>
          </div>
        )}
      </div>
      {panelOpen && !presenting && (
        <aside className="page-panel-col">
          <SidePanel />
        </aside>
      )}
      {!presenting && <HelpDialog />}
    </div>
  );
}
