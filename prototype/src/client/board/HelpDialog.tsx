import { X } from 'lucide-react';
import { setState, useBoard } from './store';

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

const SECTIONS: [string, [string, string][]][] = [
  [
    'Инструменты',
    [
      ['Выбор / Рука', 'V / H'],
      ['Стикер / Текст', 'N / T'],
      ['Фигура / Прямоугольник / Эллипс', 'S / R / O'],
      ['Коннектор / Перо / Ластик', 'L / P / E'],
      ['Фрейм / Комментарий', 'F / C'],
    ],
  ],
  [
    'Навигация',
    [
      ['Панорамирование', 'Колесо, Пробел + мышь, средняя кнопка'],
      ['Масштаб', `${mod} + колесо, pinch, + / −`],
      ['Вся доска / 100% / к выделению', 'Shift+1 / Shift+0 / Shift+2'],
      ['Поиск по доске', `${mod}+F, Enter / Shift+Enter`],
      ['Следовать за участником', 'меню аватара, Esc — перестать'],
    ],
  ],
  [
    'Фасилитация и показ',
    [
      ['Голосование', 'клик — голос, Alt+клик — снять'],
      ['Презентация фреймов', '→ ← Пробел, Home / End, Esc'],
      ['Контекстное меню', 'правый клик'],
    ],
  ],
  [
    'Редактирование',
    [
      ['Отменить / Повторить', `${mod}+Z / ${mod}+Shift+Z`],
      ['Копировать / Вырезать / Вставить', `${mod}+C / X / V`],
      ['Дублировать / Выделить всё', `${mod}+D / ${mod}+A`],
      ['Удалить', 'Delete, Backspace'],
      ['Редактировать текст', 'Enter, двойной клик'],
      ['Новый стикер', 'Двойной клик по пустому месту'],
      ['Поднять наверх / опустить вниз', 'PageUp / PageDown'],
      ['Группа / разгруппировать', `${mod}+G / ${mod}+Shift+G`],
      ['Заблокировать', `${mod}+Shift+L`],
      ['Сдвиг на 1 / 10', 'Стрелки / Shift+Стрелки'],
      ['Выровнять: лево / право / верх / низ', 'Alt+A / D / W / S'],
      ['Выровнять по центру / середине', 'Alt+H / Alt+V'],
      ['Распределить по горизонтали / вертикали', 'Alt+Shift+H / V'],
      ['Без привязки при перемещении', 'Alt'],
      ['Прервать действие', 'Esc'],
    ],
  ],
];

export function HelpDialog() {
  const open = useBoard((s) => s.showHelp);
  if (!open) return null;
  const close = () => setState({ showHelp: false });
  return (
    <div className="modal-backdrop" onPointerDown={close} data-ui>
      <div className="modal page-card" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Горячие клавиши">
        <div className="modal-head">
          <h2 className="subtitle">Горячие клавиши</h2>
          <button type="button" className="icon-btn" onClick={close} title="Закрыть" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>
        <div className="help-grid">
          {SECTIONS.map(([title, rows]) => (
            <section key={title}>
              <h3 className="help-title">{title}</h3>
              {rows.map(([a, k]) => (
                <div key={a} className="help-row">
                  <span>{a}</span>
                  <kbd>{k}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Toast() {
  const toast = useBoard((s) => s.toast);
  if (!toast) return null;
  return (
    <div className="toast panel" key={toast.id} role="status">
      {toast.text}
    </div>
  );
}
