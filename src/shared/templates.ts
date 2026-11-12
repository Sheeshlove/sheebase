import { BRAND, shapeStyle, STICKY_TONES } from './brand';
import { makeConnector, makeFrame, makeShape, makeSticky, makeText } from './defaults';
import type { Item, TemplateInfo } from './types';

export const TEMPLATES: TemplateInfo[] = [
  { id: 'blank', name: 'Пустая доска', description: 'Чистый холст без объектов' },
  { id: 'retro', name: 'Ретроспектива', description: 'Хорошо, улучшить, действия' },
  { id: 'kanban', name: 'Канбан', description: 'Бэклог, в работе, на проверке, готово' },
  { id: 'brainstorm', name: 'Брейншторм', description: 'Центральный вопрос и идеи вокруг' },
  { id: 'mindmap', name: 'Майнд-мэп', description: 'Центральная тема и ветви' },
];

type ToneId = (typeof STICKY_TONES)[number]['id'];
const tone = (id: ToneId) => STICKY_TONES.find((t) => t.id === id)!.value;

/**
 * Строит объекты шаблона в оформлении ШИБЕЙС: белые и тёмно-синие фреймы на синем холсте,
 * стикеры четырёх тонов, белый пунктир-коннектор. `uid` — генератор идентификаторов.
 */
export function buildTemplate(templateId: string, uid: () => string): Item[] {
  const items: Item[] = [];
  let z = 1;
  const push = <T extends Item>(it: T): T => {
    items.push(it);
    return it;
  };

  switch (templateId) {
    case 'retro': {
      push(makeText(uid(), 0, -150, z++, 'Ретроспектива спринта', { fontSize: 56, w: 1200, h: 73 }));
      const cols: [string, ToneId, string[]][] = [
        ['Что прошло хорошо', 'low', ['Вовремя выпустили релиз', 'Быстрые ответы в чате']],
        ['Что можно улучшить', 'high', ['Долгий code review', 'Мало автотестов']],
        ['Действия', 'sun', ['Лимит на размер PR — 400 строк']],
      ];
      cols.forEach(([title, t, notes], i) => {
        const fx = i * 760;
        push(makeFrame(uid(), fx, 0, 700, 900, z++, title));
        notes.forEach((text, j) => {
          push(makeSticky(uid(), fx + 40 + j * 224, 48, z++, tone(t), text));
        });
      });
      break;
    }
    case 'kanban': {
      push(makeText(uid(), 0, -150, z++, 'Канбан-доска команды', { fontSize: 56, w: 1200, h: 73 }));
      const cols: [string, [ToneId, string][]][] = [
        [
          'Бэклог',
          [
            ['white', 'Исследовать конкурентов'],
            ['white', 'Макеты онбординга'],
            ['sun', 'Идея: настроить аналитику'],
          ],
        ],
        [
          'В работе',
          [
            ['white', 'API авторизации'],
            ['high', 'Заблокировано: экспорт в PDF'],
          ],
        ],
        ['На проверке', [['white', 'Тёмная тема']]],
        [
          'Готово',
          [
            ['low', 'Готово: дашборд досок'],
            ['low', 'Готово: совместные курсоры'],
          ],
        ],
      ];
      cols.forEach(([title, notes], i) => {
        const fx = i * 540;
        // тёмно-синие колонки: на них читаются стикеры всех четырёх тонов, включая белый
        push(makeFrame(uid(), fx, 0, 500, 1000, z++, title, BRAND.blue700));
        notes.forEach(([t, text], j) => {
          const col = j % 2;
          const row = Math.floor(j / 2);
          push(makeSticky(uid(), fx + 40 + col * 220, 48 + row * 220, z++, tone(t), text));
        });
      });
      break;
    }
    case 'brainstorm': {
      push(makeFrame(uid(), -800, -620, 1600, 1240, z++, 'Брейншторм'));
      push(
        makeShape(uid(), 'ellipse', -220, -110, 440, 220, z++, {
          ...shapeStyle(BRAND.blue700, 'card'),
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
      ideas.forEach((text, i) => {
        const a = (i / ideas.length) * Math.PI * 2 - Math.PI / 2;
        const cx = Math.cos(a) * 560;
        const cy = Math.sin(a) * 400;
        push(makeSticky(uid(), Math.round(cx - 100), Math.round(cy - 100), z++, tone('sun'), text));
      });
      break;
    }
    case 'mindmap': {
      // на синем холсте: жёлтый центр, белые ветви, тёмно-синие листья с белой рамкой
      const center = push(
        makeShape(uid(), 'roundrect', -150, -60, 300, 120, z++, {
          ...shapeStyle(BRAND.sun400, 'surface'),
          text: 'Запуск продукта',
          fontSize: 28,
        }),
      );
      const branches: [string, string[]][] = [
        ['Аудитория', ['Стартапы', 'Агентства']],
        ['Ценность', ['Скорость', 'Совместная работа']],
        ['Каналы', ['Контент', 'Партнёры']],
        ['Метрики', ['Активация', 'Удержание']],
      ];
      branches.forEach(([title, leaves], i) => {
        const right = i % 2 === 0;
        const row = i < 2 ? -1 : 1;
        const bx = right ? 360 : -360 - 240;
        const by = row * 170 - 45;
        const node = push(
          makeShape(uid(), 'roundrect', bx, by, 240, 90, z++, { ...shapeStyle(BRAND.white, 'surface'), text: title, fontSize: 24 }),
        );
        items.push(
          makeConnector(uid(), { itemId: center.id, side: 'auto', x: 0, y: 0 }, { itemId: node.id, side: 'auto', x: 0, y: 0 }, z++, {
            endArrow: 'none',
          }),
        );
        leaves.forEach((text, j) => {
          const lx = right ? bx + 340 : bx - 300;
          const ly = by + (j === 0 ? -55 : 55);
          const leaf = push(
            makeShape(uid(), 'roundrect', lx, ly, 200, 70, z++, { ...shapeStyle(BRAND.blue700, 'surface'), text, fontSize: 18 }),
          );
          items.push(
            makeConnector(uid(), { itemId: node.id, side: 'auto', x: 0, y: 0 }, { itemId: leaf.id, side: 'auto', x: 0, y: 0 }, z++, {
              endArrow: 'none',
            }),
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
