// Компоненты дизайн-системы ШИБЕЙС.
// Перенесены из её бандла (components/bundle.js, пространство имён Shibeys) один в один:
// та же разметка, те же классы из bundle.css, те же свойства (components/index.d.ts).
// Добавлена только передача служебных атрибутов (data-testid, title) там, где они нужны приложению.

import type { KeyboardEvent, ReactNode, Ref } from 'react';

type DataAttrs = { 'data-testid'?: string; title?: string };

export interface ButtonProps extends DataAttrs {
  /** primary: заливка blue-700 для белых карточек. inverse: белая для синего фона. accent: sun-400 — одно главное действие на синем. */
  variant?: 'primary' | 'inverse' | 'accent';
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  children: ReactNode;
}

export function Button({ variant = 'primary', type = 'button', disabled, onClick, children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={`sb-btn sb-btn--${variant}`} disabled={disabled} onClick={onClick} {...rest}>
      {children}
    </button>
  );
}

export interface TagProps extends DataAttrs {
  /** neutral — контурная метка; high, medium, low — статусные заливки. */
  tone?: 'neutral' | 'high' | 'medium' | 'low';
  /** Всегда слово: статус не передаётся одним цветом. */
  children: ReactNode;
}

export function Tag({ tone = 'neutral', children, ...rest }: TagProps) {
  return (
    <span className={`sb-tag sb-tag--${tone}`} {...rest}>
      {children}
    </span>
  );
}

export interface SearchFieldProps extends DataAttrs {
  value: string;
  placeholder?: string;
  /** Доступное имя; по умолчанию — подсказка. */
  label?: string;
  onChange?: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  inputRef?: Ref<HTMLInputElement>;
}

export function SearchField({ value, placeholder, label, onChange, onKeyDown, inputRef, ...rest }: SearchFieldProps) {
  return (
    <input
      ref={inputRef}
      type="search"
      className="sb-search"
      value={value}
      placeholder={placeholder || 'Найти страницу или доску'}
      aria-label={label || placeholder || 'Поиск'}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={onKeyDown}
      {...rest}
    />
  );
}

export interface SidebarItemProps extends DataAttrs {
  label: string;
  active?: boolean;
  /** Уровень вложенности, 0–3; каждый — отступ 16px. */
  depth?: number;
  count?: number;
  onClick?: () => void;
}

export function SidebarItem({ label, active, depth = 0, count, onClick, ...rest }: SidebarItemProps) {
  return (
    <button
      type="button"
      className={'sb-side' + (active ? ' sb-side--active' : '')}
      style={{ paddingLeft: 16 + 16 * depth }}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      {...rest}
    >
      <span>{label}</span>
      {count != null ? <span className="sb-side__count">{count}</span> : null}
    </button>
  );
}

export interface PageCardProps extends DataAttrs {
  title: string;
  excerpt?: string;
  tags?: { label: string; tone?: 'neutral' | 'high' | 'medium' | 'low' }[];
  /** Автор или дата — справа в подвале карточки. */
  meta?: string;
  /** Если задан, вся карточка — кнопка. */
  onClick?: () => void;
  disabled?: boolean;
  /** Расширение приложения: превью доски над заголовком (в системе карточка без изображений). */
  preview?: ReactNode;
}

export function PageCard({ title, excerpt, tags = [], meta, onClick, disabled, preview, ...rest }: PageCardProps) {
  const body = (
    <>
      {preview}
      <h3 className="sb-card__title">{title}</h3>
      {excerpt ? <p className="sb-card__excerpt">{excerpt}</p> : null}
      <div className="sb-card__foot">
        {tags.map((t, i) => (
          <Tag key={i} tone={t.tone}>
            {t.label}
          </Tag>
        ))}
        {meta ? <span className="sb-card__meta">{meta}</span> : null}
      </div>
    </>
  );
  return onClick ? (
    <button type="button" className="sb-card" onClick={onClick} disabled={disabled} {...rest}>
      {body}
    </button>
  ) : (
    <div className="sb-card" {...rest}>
      {body}
    </div>
  );
}

export interface StickyNoteProps {
  /** sun — идея, low — готово, high — заблокировано, white — нейтрально. */
  tone?: 'sun' | 'low' | 'high' | 'white';
  children: ReactNode;
}

export function StickyNote({ tone = 'sun', children }: StickyNoteProps) {
  return <div className={`sb-note sb-note--${tone}`}>{children}</div>;
}
