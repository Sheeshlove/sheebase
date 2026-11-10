import { makeConnector, makeFrame, makeShape, makeSticky, makeText, STICKY_COLORS } from './defaults';
import type { Item, TemplateInfo } from './types';

export const TEMPLATES: TemplateInfo[] = [
  { id: 'blank', name: 'Пустая доска', description: 'Чистый холст без объектов' },
  { id: 'retro', name: 'Ретроспектива', description: 'Хорошо / Улучшить / Действия' },
  { id: 'kanban', name: 'Канбан', description: 'Бэклог, в работе, на проверке, готово' },
  { id: 'brainstorm', name: 'Брейншторм', description: 'Центральный вопрос и идеи вокруг' },
  { id: 'mindmap', name: 'Майнд-мэп', description: 'Центральная тема и ветви' },
];

const color = (name: string) => STICKY_COLORS.find((c) => c.name === name)!.value;

/** Строит объекты шаблона. `uid` — генератор идентификаторов. */
export function buildTemplate(templateId: string, uid: () => string): Item[] {
  const items: Item[] = [];
  let z = 1;
  const push = <T extends Item>(it: T): T => {
    items.push(it);
    return it;
  };

  switch (templateId) {
    case 'retro': {
      push(makeText(uid(), 0, -150, z++, 'Ретроспектива спринта', { fontSize: 56, bold: true, w: 1200, h: 73 }));
      const cols: [string, string, string, string[]][] = [
        ['Что прошло хорошо', '#ebfbee', 'Зелёный', ['Вовремя выпустили релиз', 'Быстрые ответы в чате']],
        ['Что можно улучшить', '#fff5f5', 'Красный', ['Долгий code review', 'Мало автотестов']],
        ['Действия', '#e7f5ff', 'Синий', ['Лимит на размер PR — 400 строк']],
      ];
      cols.forEach(([title, fill, sticky, notes], i) => {
        const fx = i * 760;
        push(makeFrame(uid(), fx, 0, 700, 900, z++, title, fill));
        notes.forEach((text, j) => {
          push(makeSticky(uid(), fx + 30 + j * 220, 40, z++, color(sticky), text));
        });
      });
      break;
    }
    case 'kanban': {
      push(makeText(uid(), 0, -150, z++, 'Канбан-доска команды', { fontSize: 56, bold: true, w: 1200, h: 73 }));
      const cols: [string, string[]][] = [
        ['Бэклог', ['Исследовать конкурентов', 'Макеты онбординга', 'Настроить аналитику']],
        ['В работе', ['API авторизации', 'Экспорт в PDF']],
        ['На проверке', ['Тёмная тема']],
        ['Готово', ['Дашборд досок', 'Совместные курсоры']],
      ];
      const colors = ['Жёлтый', 'Оранжевый', 'Фиолетовый', 'Зелёный'];
      cols.forEach(([title, notes], i) => {
        const fx = i * 540;
        push(makeFrame(uid(), fx, 0, 500, 1000, z++, title, '#f8f9fa'));
        notes.forEach((text, j) => {
          const col = j % 2;
          const row = Math.floor(j / 2);
          push(makeSticky(uid(), fx + 40 + col * 220, 40 + row * 220, z++, color(colors[i]), text));
        });
      });
      break;
    }
    case 'brainstorm': {
      push(makeFrame(uid(), -800, -620, 1600, 1240, z++, 'Брейншторм', '#ffffff'));
      push(
        makeShape(uid(), 'ellipse', -220, -110, 440, 220, z++, {
          fill: '#ffec99',
          stroke: '#f08c00',
          strokeWidth: 3,
          text: 'Как улучшить онбординг новых пользователей?',
          fontSize: 28,
        }),
      );
      const ideas = [
        'Интерактивный тур',
        'Шаблоны досок',
        'Видео за 60 секунд',
        'Чек-лист первых шагов',
        'Пример готовой доски',
        'Подсказки по клавишам',
        'Пригласить команду',
        'Письмо через 3 дня',
      ];
      const names = ['Жёлтый', 'Оранжевый', 'Розовый', 'Фиолетовый', 'Синий', 'Голубой', 'Зелёный', 'Салатовый'];
      ideas.forEach((text, i) => {
        const a = (i / ideas.length) * Math.PI * 2 - Math.PI / 2;
        const cx = Math.cos(a) * 560;
        const cy = Math.sin(a) * 400;
        push(makeSticky(uid(), Math.round(cx - 100), Math.round(cy - 100), z++, color(names[i]), text));
      });
      break;
    }
    case 'mindmap': {
      const center = push(
        makeShape(uid(), 'roundrect', -150, -60, 300, 120, z++, {
          fill: '#d0bfff',
          stroke: '#7048e8',
          strokeWidth: 3,
          text: 'Запуск продукта',
          fontSize: 28,
        }),
      );
      const branches: [string, string, string, string[]][] = [
        ['Аудитория', '#a5d8ff', '#1971c2', ['Стартапы', 'Агентства']],
        ['Ценность', '#b2f2bb', '#2f9e44', ['Скорость', 'Совместная работа']],
        ['Каналы', '#ffd8a8', '#f08c00', ['Контент', 'Партнёры']],
        ['Метрики', '#ffc9c9', '#e03131', ['Активация', 'Удержание']],
      ];
      branches.forEach(([title, fill, stroke, leaves], i) => {
        const right = i % 2 === 0;
        const row = i < 2 ? -1 : 1;
        const bx = right ? 360 : -360 - 240;
        const by = row * 170 - 45;
        const node = push(makeShape(uid(), 'roundrect', bx, by, 240, 90, z++, { fill, stroke, text: title, fontSize: 24 }));
        items.push(
          makeConnector(
            uid(),
            { itemId: center.id, side: 'auto', x: 0, y: 0 },
            { itemId: node.id, side: 'auto', x: 0, y: 0 },
            z++,
            { stroke, strokeWidth: 3, endArrow: 'none' },
          ),
        );
        leaves.forEach((text, j) => {
          const lx = right ? bx + 340 : bx - 300;
          const ly = by + (j === 0 ? -55 : 55);
          const leaf = push(
            makeShape(uid(), 'rect', lx, ly, 200, 70, z++, {
              fill: '#ffffff',
              stroke,
              strokeWidth: 2,
              text,
              fontSize: 18,
            }),
          );
          items.push(
            makeConnector(
              uid(),
              { itemId: node.id, side: 'auto', x: 0, y: 0 },
              { itemId: leaf.id, side: 'auto', x: 0, y: 0 },
              z++,
              { stroke, strokeWidth: 2, endArrow: 'none' },
            ),
          );
        });
      });
      break;
    }
    default:
      break;
  }
  return items;
}
