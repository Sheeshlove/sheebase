import { expect, it } from 'vitest';
import { PACKAGE } from './index';

it('M0.1: пакет board-engine собирается и импортируется', () => {
  expect(PACKAGE).toBe('@shibase/board-engine');
});
