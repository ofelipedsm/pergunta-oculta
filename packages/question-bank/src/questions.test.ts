import { describe, expect, it } from 'vitest';
import { CATEGORIES, LIMITS, answerOk, norm, splitWords } from '@po/shared';
import { QUESTIONS, filterQuestions } from './index';

describe('banco de perguntas', () => {
  it('tem ids únicos', () => {
    const ids = new Set(QUESTIONS.map((q) => q.id));
    expect(ids.size).toBe(QUESTIONS.length);
  });

  it('não tem perguntas repetidas', () => {
    const texts = new Set(QUESTIONS.map((q) => norm(q.question)));
    expect(texts.size).toBe(QUESTIONS.length);
  });

  it('usa só categorias e níveis válidos', () => {
    for (const q of QUESTIONS) {
      expect(CATEGORIES).toContain(q.category);
      expect([1, 2, 3]).toContain(q.level);
    }
  });

  it('toda pergunta cabe nos limites de palavras', () => {
    for (const q of QUESTIONS) {
      const n = splitWords(q.question).length;
      expect(n, q.id).toBeGreaterThanOrEqual(LIMITS.questionMinWords);
      expect(n, q.id).toBeLessThanOrEqual(LIMITS.questionMaxWords);
    }
  });

  it('toda resposta cadastrada é aceita pela própria checagem', () => {
    for (const q of QUESTIONS) {
      for (const a of q.answers) expect(answerOk(a, q.answers), `${q.id}: ${a}`).toBe(true);
    }
  });

  it('filtra por categoria e nível', () => {
    const list = filterQuestions(['Brasil'], [3]);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((q) => q.category === 'Brasil' && q.level === 3)).toBe(true);
  });
});
