import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useBoard } from './board/store';
import './styles.css';

// Только чтение состояния — для e2e-тестов и отладки из консоли.
(window as unknown as { __sheebase: unknown }).__sheebase = { state: () => useBoard.getState() };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
