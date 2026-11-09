import { afterEach, describe, expect, it } from 'vitest';
import { corsOrigin, isOriginAllowed } from './cors';

describe('CORS_ORIGIN', () => {
  afterEach(() => {
    delete process.env.CORS_ORIGIN;
  });

  it('ausente ou vazia libera tudo', () => {
    expect(corsOrigin()).toBe(true);
    process.env.CORS_ORIGIN = '  ';
    expect(corsOrigin()).toBe(true);
    expect(isOriginAllowed('https://qualquer.site')).toBe(true);
  });

  it('aceita lista separada por vírgula e ignora barra no final', () => {
    process.env.CORS_ORIGIN = 'https://po.vercel.app/, https://perguntaoculta.com.br';
    expect(corsOrigin()).toEqual(['https://po.vercel.app', 'https://perguntaoculta.com.br']);
    expect(isOriginAllowed('https://po.vercel.app')).toBe(true);
    expect(isOriginAllowed('https://outro.site')).toBe(false);
    expect(isOriginAllowed(undefined)).toBe(true);
  });
});
