import { describe, expect, it } from 'vitest';
import { answerOk, lev, norm, questionOk, splitWords } from './normalize';

describe('norm', () => {
  it('remove acento, caixa, pontuação e artigos', () => {
    expect(norm('O Pão de Açúcar!')).toBe('pao acucar');
  });
  it('junta dígitos separados por pontuação', () => {
    expect(norm('300.000')).toBe('300000');
  });
});

describe('lev', () => {
  it('conta edições', () => {
    expect(lev('gato', 'pato')).toBe(1);
    expect(lev('', 'abc')).toBe(3);
  });
});

describe('answerOk', () => {
  it('aceita variações de acento, caixa e artigo', () => {
    expect(answerOk('o japao', ['Japão'])).toBe(true);
    expect(answerOk('BRASÍLIA', ['Brasília'])).toBe(true);
  });
  it('tolera erro de digitação proporcional ao tamanho', () => {
    expect(answerOk('einstien', ['Einstein'])).toBe(true);
    expect(answerOk('mal', ['Mel'])).toBe(false);
  });
  it('números só valem exatos', () => {
    expect(answerOk('6', ['5'])).toBe(false);
    expect(answerOk('1888', ['1889'])).toBe(false);
    expect(answerOk('206', ['206'])).toBe(true);
  });
  it('aceita qualquer resposta da lista', () => {
    expect(answerOk('chita', ['Guepardo', 'Chita'])).toBe(true);
  });
  it('recusa vazio', () => {
    expect(answerOk('   ', ['Peru'])).toBe(false);
  });
});

describe('questionOk', () => {
  const q = 'Qual animal tem o pescoço mais comprido de todos';
  it('aceita a pergunta com pequenas diferenças', () => {
    expect(questionOk('qual animal tem pescoco mais comprido de todos?', q)).toBe(true);
  });
  it('recusa pergunta diferente', () => {
    expect(questionOk('qual animal é o mais rápido', q)).toBe(false);
  });
});

describe('splitWords', () => {
  it('ignora interrogação final e espaços extras', () => {
    expect(splitWords('  Qual é a capital do Brasil?  ')).toEqual(['Qual', 'é', 'a', 'capital', 'do', 'Brasil']);
  });
});
