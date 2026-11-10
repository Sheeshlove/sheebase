import { RotateCcw, Save, Trash, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ItemMap, VersionMeta } from '../../shared/types';
import { api } from '../api';
import { timeAgo } from './Comments';
import { buildSvg } from './exporter';
import { setState, showToast, useBoard } from './store';

function plural(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'объект';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'объекта';
  return 'объектов';
}

export function VersionsPanel() {
  const boardId = useBoard((s) => s.boardId);
  const [list, setList] = useState<VersionMeta[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ meta: VersionMeta; url: string | null } | null>(null);

  const load = () => {
    if (!boardId) return;
    api
      .versions(boardId)
      .then(setList)
      .catch(() => showToast('Не удалось загрузить историю версий'));
  };
  useEffect(load, [boardId]);

  const save = async () => {
    if (!boardId || busy) return;
    setBusy(true);
    try {
      await api.saveVersion(boardId, name.trim() || `Версия от ${new Date().toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}`);
      setName('');
      showToast('Версия сохранена');
      load();
    } catch {
      showToast('Не удалось сохранить версию');
    } finally {
      setBusy(false);
    }
  };

  const open = async (meta: VersionMeta) => {
    if (!boardId) return;
    setPreview({ meta, url: null });
    try {
      const v = await api.version(boardId, meta.id);
      const items: ItemMap = v.items;
      const svg = buildSvg(Object.values(items), items);
      setPreview({ meta, url: svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.svg)}` : '' });
    } catch {
      showToast('Не удалось открыть версию');
      setPreview(null);
    }
  };

  const restore = async (meta: VersionMeta) => {
    if (!boardId || !window.confirm(`Восстановить доску из версии «${meta.name}»? Текущее состояние сохранится отдельной версией.`)) return;
    try {
      await api.restoreVersion(boardId, meta.id);
      setPreview(null);
      load();
    } catch {
      showToast('Не удалось восстановить версию');
    }
  };

  const remove = async (meta: VersionMeta) => {
    if (!boardId || !window.confirm(`Удалить версию «${meta.name}»?`)) return;
    await api.deleteVersion(boardId, meta.id).catch(() => showToast('Не удалось удалить версию'));
    setPreview(null);
    load();
  };

  return (
    <>
      <div className="side-panel panel" data-ui data-testid="versions-panel">
        <div className="side-head">
          <h3>История версий</h3>
          <button type="button" className="icon-btn small" onClick={() => setState({ panel: null })} aria-label="Закрыть">
            <X size={16} />
          </button>
        </div>
        <form
          className="version-save"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название версии" maxLength={120} data-testid="version-name" />
          <button type="submit" className="primary-btn small" disabled={busy} data-testid="version-save">
            <Save size={14} /> Сохранить
          </button>
        </form>
        <div className="hint pad">Автоматически версия сохраняется перед первой правкой после 10 минут паузы.</div>
        <div className="side-list">
          {list === null && <div className="empty small">Загрузка…</div>}
          {list?.length === 0 && <div className="empty small">Версий пока нет.</div>}
          {list?.map((v) => (
            <button type="button" key={v.id} className="side-item" onClick={() => void open(v)} data-testid="version-row">
              <div className="side-item-body">
                <div className="clamp-2">
                  {v.name} {v.auto && <span className="badge">авто</span>}
                </div>
                <div className="muted small-text">
                  {timeAgo(v.createdAt)} · {v.itemCount} {plural(v.itemCount)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      {preview && (
        <div className="modal-backdrop" onPointerDown={() => setPreview(null)} data-ui>
          <div className="modal panel version-preview" onPointerDown={(e) => e.stopPropagation()} data-testid="version-preview">
            <div className="modal-head">
              <h2>{preview.meta.name}</h2>
              <button type="button" className="icon-btn" onClick={() => setPreview(null)} aria-label="Закрыть">
                <X size={18} />
              </button>
            </div>
            <div className="muted small-text">
              {new Date(preview.meta.createdAt).toLocaleString('ru-RU')} · {preview.meta.itemCount} {plural(preview.meta.itemCount)}
            </div>
            <div className="preview-box">
              {preview.url === null ? 'Загрузка…' : preview.url ? <img src={preview.url} alt="Предпросмотр версии" /> : 'Пустая доска'}
            </div>
            <div className="row-buttons end">
              <button type="button" className="chip" onClick={() => void remove(preview.meta)}>
                <Trash size={14} /> Удалить версию
              </button>
              <button type="button" className="primary-btn" onClick={() => void restore(preview.meta)} data-testid="version-restore">
                <RotateCcw size={16} /> Восстановить
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
