import { describe, expect, it } from 'vitest';
import { EnvError, loadEnv } from './env';

const secrets = { SESSION_SECRET: 's'.repeat(64), COLLAB_JWT_SECRET: 'c'.repeat(64) };

describe('M0.2: валидация окружения (разд. 13.5)', () => {
  it('подставляет значения по умолчанию для локальной разработки', () => {
    const env = loadEnv(secrets);
    expect(env.API_PORT).toBe(3000);
    expect(env.COLLAB_PORT).toBe(3001);
    expect(env.LLM_PROVIDER).toBe('mock');
  });

  it('перечисляет все недостающие и неверные переменные', () => {
    try {
      loadEnv({ API_PORT: 'abc', LLM_PROVIDER: 'openai' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      const text = (err as EnvError).problems.join('\n');
      for (const name of ['SESSION_SECRET', 'COLLAB_JWT_SECRET', 'API_PORT', 'LLM_PROVIDER'])
        expect(text).toContain(name);
    }
  });
});
