import { expect, it } from 'vitest';
import { PACKAGE } from './index';

it('M0.1: пакет ai собирается и импортируется', () => {
  expect(PACKAGE).toBe('@shibase/ai');
});
