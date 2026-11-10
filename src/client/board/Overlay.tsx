import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { boundsOf, connectorGeometry, itemBounds, type Rect } from '../../shared/geometry';
import type { Item } from '../../shared/types';
import type { Handle } from './interactions';
import { CommentPins } from './Comments';
import { type Camera, type PeerState, useBoard, votingActive, worldRectToScreen, worldToScreen } from './store';

const ALL_HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CORNERS: Handle[] = ['nw', 'ne', 'se', 'sw'];

function handlesFor(items: Item[]): Handle[] {
  if (items.length !== 1) return CORNERS;
  const it = items[0];
  switch (it.type) {
    case 'sticky':
    case 'image':
      return CORNERS;
    case 'text':
      return [...CORNERS, 'e', 'w'];
    case 'connector':
      return [];
    default:
      return ALL_HANDLES;
  }
}

function handlePos(r: Rect, h: Handle) {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

function Box({ r, className, color }: { r: Rect; className: string; color?: string }) {
  return (
    <div
      className={className}
      style={{ transform: `translate(${r.x}px, ${r.y}px)`, width: r.w, height: r.h, borderColor: color }}
    />
  );
}

function ConnectorHandles({ item, cam }: { item: Extract<Item, { type: 'connector' }>; cam: Camera }) {
  const items = useBoard((s) => s.items);
  const g = connectorGeometry(item, items);
  const ends: ['from' | 'to', { x: number; y: number }][] = [
    ['from', g.start],
    ['to', g.end],
  ];
  return (
    <>
      {ends.map(([end, p]) => {
        const s = worldToScreen(cam, p);
        const attached = !!item[end].itemId && !!items[item[end].itemId!];
        return (
          <div
            key={end}
            data-handle={`ep-${end}`}
            data-target={item.id}
            className={`endpoint ${attached ? 'attached' : ''}`}
            style={{ transform: `translate(${s.x}px, ${s.y}px)` }}
            title="Перетащите, чтобы переподключить"
          />
        );
      })}
    </>
  );
}

function PeerLayer({ cam }: { cam: Camera }) {
  const peers = useBoard((s) => s.peers);
  const items = useBoard((s) => s.items);
  const list = Object.values(peers) as PeerState[];
  return (
    <>
      {list.map((p) => {
        const it = p.editing ? items[p.editing] : undefined;
        if (!it) return null;
        const r = worldRectToScreen(cam, itemBounds(it, items));
        return (
          <div key={`edit-${p.clientId}`} className="peer-tag editing" style={{ transform: `translate(${r.x}px, ${r.y + r.h + 4}px)`, background: p.color }}>
            ✎ {p.name}
          </div>
        );
      })}
      {list.map((p) =>
        p.selection.map((id, i) => {
          const it = items[id];
          if (!it) return null;
          const r = worldRectToScreen(cam, itemBounds(it, items));
          return (
            <div key={`${p.clientId}-${id}`}>
              <Box r={{ x: r.x - 3, y: r.y - 3, w: r.w + 6, h: r.h + 6 }} className="peer-selection" color={p.color} />
              {i === 0 && (
                <div className="peer-tag" style={{ transform: `translate(${r.x - 3}px, ${r.y - 22}px)`, background: p.color }}>
                  {p.name}
                </div>
              )}
            </div>
          );
        }),
      )}
      {list.map((p) => {
        if (!p.cursor) return null;
        const s = worldToScreen(cam, p.cursor);
        return (
          <div key={p.clientId} className="cursor" style={{ transform: `translate(${s.x}px, ${s.y}px)` }}>
            <svg width="18" height="22" viewBox="0 0 18 22">
              <path d="M1 1 L1 17 L5.5 13 L8.5 20 L11.5 18.7 L8.6 12 L15 12 Z" fill={p.color} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
            <span style={{ background: p.color }}>{p.name}</span>
          </div>
        );
      })}
    </>
  );
}

/** Бейджи голосования: во время сессии — свои голоса, после — итоги. */
function VoteBadges({ cam }: { cam: Camera }) {
  const voting = useBoard((s) => s.session.voting);
  const items = useBoard((s) => s.items);
  if (!voting) return null;
  const counts = voting.status === 'active' ? voting.myVotes : (voting.results ?? {});
  return (
    <>
      {Object.entries(counts).map(([id, n]) => {
        const it = items[id];
        if (!it || n <= 0) return null;
        const r = worldRectToScreen(cam, itemBounds(it, items));
        return (
          <div
            key={id}
            className={`vote-badge ${voting.status === 'active' ? 'mine' : 'total'}`}
            style={{ transform: `translate(${r.x + r.w}px, ${r.y}px)` }}
            data-testid="vote-badge"
          >
            {n}
          </div>
        );
      })}
    </>
  );
}

function SearchHighlights({ cam }: { cam: Camera }) {
  const search = useBoard((s) => s.search);
  const items = useBoard((s) => s.items);
  if (!search.open || !search.hits.length) return null;
  return (
    <>
      {search.hits.map((id, i) => {
        const it = items[id];
        if (!it) return null;
        const r = worldRectToScreen(cam, itemBounds(it, items));
        return <Box key={id} r={{ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }} className={`search-hit ${i === search.index ? 'current' : ''}`} />;
      })}
    </>
  );
}

export function Overlay() {
  const cam = useBoard((s) => s.camera);
  const selected = useBoard(useShallow((s) => s.selection.map((id) => s.items[id]).filter(Boolean) as Item[]));
  const items = useBoard((s) => s.items);
  const editingId = useBoard((s) => s.editingId);
  const marquee = useBoard((s) => s.marquee);
  const guides = useBoard((s) => s.guides);
  const interaction = useBoard((s) => s.interaction);
  const hoverTarget = useBoard((s) => s.hoverTarget);
  const tool = useBoard((s) => s.tool);
  const frozen = useBoard((s) => votingActive(s) || !!s.presenting);
  const presenting = useBoard((s) => !!s.presenting);

  const selBox = useMemo(() => {
    if (!selected.length) return null;
    const b = boundsOf(
      selected.map((i) => i.id),
      items,
    );
    return b && worldRectToScreen(cam, b);
  }, [selected, items, cam]);

  const single = selected.length === 1 ? selected[0] : null;
  const anyLocked = selected.some((i) => i.locked);
  const showHandles = tool === 'select' && !editingId && !anyLocked && interaction !== 'move' && !frozen;
  const handles = showHandles ? handlesFor(selected) : [];
  const showDots =
    showHandles &&
    !interaction &&
    single &&
    ['sticky', 'shape', 'text', 'image'].includes(single.type) &&
    selBox !== null;

  const hover = hoverTarget ? items[hoverTarget] : null;

  if (presenting) return <div className="overlay" />;

  return (
    <div className="overlay">
      <SearchHighlights cam={cam} />
      <PeerLayer cam={cam} />
      <VoteBadges cam={cam} />
      <CommentPins cam={cam} />

      {hover && <Box r={worldRectToScreen(cam, itemBounds(hover, items))} className="hover-target" />}

      {selected.length > 1 &&
        selected.map((it) => (
          <Box key={it.id} r={worldRectToScreen(cam, itemBounds(it, items))} className="sel-item" />
        ))}

      {selBox && !(single?.type === 'connector') && (
        <Box
          r={{ x: selBox.x - 1, y: selBox.y - 1, w: selBox.w + 2, h: selBox.h + 2 }}
          className={`sel-box ${anyLocked ? 'locked' : ''}`}
        />
      )}

      {single?.type === 'connector' && !anyLocked && tool === 'select' && !frozen && <ConnectorHandles item={single} cam={cam} />}

      {selBox &&
        handles.map((h) => {
          const p = handlePos(selBox, h);
          return (
            <div
              key={h}
              data-handle={h}
              className={`handle handle-${h} ${h.length === 1 ? 'edge' : ''}`}
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
            />
          );
        })}

      {showDots &&
        (['top', 'right', 'bottom', 'left'] as const).map((side) => {
          const r = selBox!;
          const off = 22;
          const p =
            side === 'top'
              ? { x: r.x + r.w / 2, y: r.y - off }
              : side === 'bottom'
                ? { x: r.x + r.w / 2, y: r.y + r.h + off }
                : side === 'left'
                  ? { x: r.x - off, y: r.y + r.h / 2 }
                  : { x: r.x + r.w + off, y: r.y + r.h / 2 };
          return (
            <div
              key={side}
              data-handle={`dot-${side}`}
              data-target={single!.id}
              className="quick-dot"
              style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
              title="Клик — создать связанный объект, перетаскивание — провести линию"
            >
              +
            </div>
          );
        })}

      {marquee && <Box r={worldRectToScreen(cam, marquee)} className="marquee" />}

      {guides.map((g, i) => {
        if (g.axis === 'x') {
          const a = worldToScreen(cam, { x: g.at, y: g.from });
          const b = worldToScreen(cam, { x: g.at, y: g.to });
          return <div key={i} className="guide" style={{ transform: `translate(${a.x}px, ${a.y}px)`, width: 1, height: b.y - a.y }} />;
        }
        const a = worldToScreen(cam, { x: g.from, y: g.at });
        const b = worldToScreen(cam, { x: g.to, y: g.at });
        return <div key={i} className="guide" style={{ transform: `translate(${a.x}px, ${a.y}px)`, width: b.x - a.x, height: 1 }} />;
      })}
    </div>
  );
}
