import { useEffect, useState } from 'react';
import { BoardPage } from './board/BoardPage';
import { Dashboard } from './pages/Dashboard';

function parseRoute(hash: string): { page: 'dashboard' } | { page: 'board'; id: string } {
  const m = /^#\/b\/([A-Za-z0-9_-]+)/.exec(hash);
  return m ? { page: 'board', id: m[1] } : { page: 'dashboard' };
}

/** Маршрутизация по hash: #/ — дашборд, #/b/<id> — доска. */
export function App() {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseRoute(location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return route.page === 'board' ? <BoardPage key={route.id} id={route.id} /> : <Dashboard />;
}
