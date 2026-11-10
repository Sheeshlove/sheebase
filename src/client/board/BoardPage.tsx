import { useEffect } from 'react';
import {
  bringToFront,
  canEditText,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  insertImageFile,
  nudgeSelection,
  pasteText,
  redo,
  selectAll,
  sendToBack,
  serializeSelection,
  setSelection,
  setTool,
  startEditing,
  toggleLock,
  undo,
  ungroupSelection,
  zoomToSelection,
} from './actions';
import { Canvas, interactions } from './Canvas';
import { ContextToolbar } from './ContextToolbar';
import { board } from './controller';
import { HelpDialog, Toast } from './HelpDialog';
import { NavControls } from './NavControls';
import { getState, setState, type Tool, useBoard } from './store';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';

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
};

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
  if (code === 'Space') {
    e.preventDefault();
    if (!st.spacePan) setState({ spacePan: true });
    return;
  }

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
      case 'Equal':
      case 'NumpadAdd':
        board.zoomAt(st.camera.zoom * 1.25);
        break;
      case 'Minus':
      case 'NumpadSubtract':
        board.zoomAt(st.camera.zoom / 1.25);
        break;
      case 'Digit0':
        board.zoomAt(1);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
    return;
  }
  if (e.altKey) return;

  if (e.shiftKey && code === 'Digit1') return void board.zoomToFit();
  if (e.shiftKey && code === 'Digit0') return void board.zoomAt(1);
  if (e.shiftKey && code === 'Digit2') return void zoomToSelection();
  if (e.key === '?' || (e.shiftKey && code === 'Slash')) return void setState({ showHelp: true });

  switch (e.key) {
    case 'Escape':
      if (interactions?.active) interactions.cancel();
      else if (st.tool !== 'select') setTool('select');
      else setSelection([]);
      return;
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
    case '+':
    case '=':
      board.zoomAt(st.camera.zoom * 1.25);
      return;
    case '-':
    case '_':
      board.zoomAt(st.camera.zoom / 1.25);
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
  if (isEditable(e.target) || !getState().selection.length) return;
  const data = serializeSelection();
  if (!data || !e.clipboardData) return;
  e.clipboardData.setData('text/plain', data);
  e.preventDefault();
  if (cut) deleteSelection();
}

function onPaste(e: ClipboardEvent) {
  if (isEditable(e.target) || !getState().loaded || !e.clipboardData) return;
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
  if (t.closest?.('button') && !t.closest('input')) e.preventDefault();
}

export function BoardPage({ id }: { id: string }) {
  const loaded = useBoard((s) => s.loaded);
  const status = useBoard((s) => s.status);
  const error = useBoard((s) => s.error);
  const name = useBoard((s) => s.meta?.name);

  useEffect(() => {
    board.open(id);
    return () => board.close();
  }, [id]);

  useEffect(() => {
    document.title = name ? `${name} — Sheebase Board` : 'Sheebase Board';
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

  return (
    <div className="board-page">
      <Canvas />
      <TopBar />
      <Toolbar />
      <ContextToolbar />
      <NavControls />
      <HelpDialog />
      <Toast />
      {!loaded && status !== 'error' && (
        <div className="loading" data-testid="loading">
          <div className="spinner" /> Загрузка доски…
        </div>
      )}
      {status === 'error' && (
        <div className="fatal">
          <div className="panel fatal-box">
            <h2>{error ?? 'Ошибка'}</h2>
            <p>Возможно, доска была удалена или ссылка неверна.</p>
            <a className="primary-btn" href="#/">
              Ко всем доскам
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
