import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useBoard } from './board/store';
import { resetTextCache } from './board/text';
// Дизайн-система ШИБЕЙС: токены и шрифты, стили её компонентов, затем стили приложения
import './design/tokens.css';
import './design/bundle.css';
import './styles.css';

// Только чтение состояния — для e2e-тестов и отладки из консоли.
(window as unknown as { __sheebase: unknown }).__sheebase = { state: () => useBoard.getState() };

// Текст объектов раскладывается по измерениям canvas, поэтому шрифты должны быть
// загружены до первой отрисовки. Если сеть медленная, начинаем с запасной гарнитурой
// и перекладываем текст, когда шрифты придут.
const FACES = ['400 17px "Acari Sans"', '700 17px "Acari Sans"', '400 40px "Ambidexter"'];
const fonts = Promise.all(FACES.map((f) => document.fonts.load(f, 'ШИБЕЙС Доски 123'))).then(
  () => true,
  () => false,
);
const timeout = new Promise<false>((resolve) => setTimeout(() => resolve(false), 2500));

void Promise.race([fonts, timeout]).then((loadedInTime) => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  if (!loadedInTime) {
    void fonts.then(() => {
      resetTextCache();
      useBoard.setState({ fontEpoch: Date.now() });
    });
  }
});
