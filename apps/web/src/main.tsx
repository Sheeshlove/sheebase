import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PRODUCT_NAME } from '@shibase/shared';
import { ru } from './i18n/ru';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <main>
      <h1>{PRODUCT_NAME}</h1>
      <p>{ru.app.skeleton}</p>
    </main>
  </StrictMode>,
);
