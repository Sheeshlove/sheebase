import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ItemMap, VersionMeta } from '../../shared/types';
import { api } from '../api';
import { Button, Tag } from '../design/components';
import { timeAgo } from './Comments';
import { buildSvg, exportFontCss } from './exporter';
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
      const [v, fontCss] = await Promise.all([api.version(boardId, meta.id), exportFontCss()]);
      const items: ItemMap = v.items;
      const svg = buildSvg(Object.values(items), items, fontCss);
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
      <div className="page-panel" data-ui data-testid="versions-panel">
        <div className="side-head">
          <h2 className="subtitle">Версии</h2>
          <button type="button" className="icon-btn" onClick={() => setState({ panel: null })} title="Закрыть" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <form
          className="version-save"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="Название версии"
            aria-label="Название версии"
            maxLength={120}
            data-testid="version-name"
          />
          <button type="submit" className="chip primary" disabled={busy} data-testid="version-save">
            Сохранить
          </button>
        </form>
        <p className="panel-hint">Версия сохраняется сама перед первой правкой после 10 минут паузы.</p>
        <div className="side-list">
          {list === null && <div className="panel-empty">Загрузка</div>}
          {list?.length === 0 && <div className="panel-empty">Здесь пока пусто. Сохраните первую версию.</div>}
          {list?.map((v) => (
            <button type="button" key={v.id} className="side-item" onClick={() => void open(v)} data-testid="version-row">
              <div className="side-item-body">
                <div className="item-title">
                  <span className="clamp-2">{v.name}</span>
                  {v.auto && <Tag>Авто</Tag>}
                </div>
                <div className="meta-line">
                  {timeAgo(v.createdAt)} · {v.itemCount} {plural(v.itemCount)}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      {preview && (
        <div className="modal-backdrop" onPointerDown={() => setPreview(null)} data-ui>
          <div className="modal page-card version-preview" onPointerDown={(e) => e.stopPropagation()} data-testid="version-preview" role="dialog" aria-label={`Версия «${preview.meta.name}»`}>
            <div className="modal-head">
              <h2 className="subtitle">{preview.meta.name}</h2>
              <button type="button" className="icon-btn" onClick={() => setPreview(null)} title="Закрыть" aria-label="Закрыть">
                <X size={20} />
              </button>
            </div>
            <p className="meta-line">
              {new Date(preview.meta.createdAt).toLocaleString('ru-RU')} · {preview.meta.itemCount} {plural(preview.meta.itemCount)}
            </p>
            <div className="preview-box">
              {preview.url === null ? <span className="stat">Загрузка</span> : preview.url ? <img src={preview.url} alt="Предпросмотр версии" /> : <span className="stat">Пустая доска</span>}
            </div>
            <div className="row-buttons end">
              <button type="button" className="chip" onClick={() => void remove(preview.meta)}>
                Удалить версию
              </button>
              <Button variant="primary" onClick={() => void restore(preview.meta)} data-testid="version-restore">
                Восстановить
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
