import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { searchItems } from '../../shared/layout';
import { SearchField } from '../design/components';
import { focusItem } from './actions';
import { getState, setState, useBoard } from './store';

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function openSearch() {
  const st = getState();
  if (st.search.open) {
    const input = document.querySelector<HTMLInputElement>('[data-testid=search-input]');
    input?.focus();
    input?.select();
    return;
  }
  setState({ search: { ...st.search, open: true, hits: searchItems(st.items, st.search.query), index: 0 } });
}

export function closeSearch() {
  const st = getState();
  setState({ search: { ...st.search, open: false, hits: [], index: 0 } });
}

/** Перейти к следующему (+1) или предыдущему (−1) совпадению. */
function go(delta: number) {
  const s = getState().search;
  if (!s.hits.length) return;
  const index = (s.index + delta + s.hits.length) % s.hits.length;
  setState({ search: { ...s, index } });
  focusItem(s.hits[index], false);
}

export function SearchBar() {
  const search = useBoard((s) => s.search);
  const items = useBoard((s) => s.items);
  const inputRef = useRef<HTMLInputElement>(null);

  // доска меняется — пересчитываем совпадения
  useEffect(() => {
    if (!search.open) return;
    const st = getState();
    const hits = searchItems(items, st.search.query);
    if (!sameList(hits, st.search.hits)) {
      setState({ search: { ...st.search, hits, index: Math.min(st.search.index, Math.max(0, hits.length - 1)) } });
    }
  }, [items, search.open]);

  useEffect(() => {
    if (search.open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [search.open]);

  if (!search.open) return null;
  const { hits, index, query } = search;
  return (
    <div className="search-bar panel bar" data-ui data-testid="search-bar">
      <SearchField
        inputRef={inputRef}
        value={query}
        placeholder="Найти на доске"
        data-testid="search-input"
        onChange={(q) => {
          const found = searchItems(getState().items, q);
          setState({ search: { ...getState().search, query: q, hits: found, index: 0 } });
          if (found[0]) focusItem(found[0], false);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            go(e.shiftKey ? -1 : 1);
          }
          if (e.key === 'Escape') closeSearch();
        }}
      />
      <span className="search-count" data-testid="search-count">
        {hits.length ? `${index + 1} из ${hits.length}` : query.trim() ? 'Ничего не найдено' : ''}
      </span>
      <button type="button" className="icon-btn" onClick={() => go(-1)} disabled={!hits.length} title="Показать предыдущее (Shift+Enter)" aria-label="Показать предыдущее">
        <ChevronUp size={20} />
      </button>
      <button type="button" className="icon-btn" onClick={() => go(1)} disabled={!hits.length} title="Показать следующее (Enter)" aria-label="Показать следующее">
        <ChevronDown size={20} />
      </button>
      <button type="button" className="icon-btn" onClick={closeSearch} title="Закрыть (Esc)" aria-label="Закрыть">
        <X size={20} />
      </button>
    </div>
  );
}
