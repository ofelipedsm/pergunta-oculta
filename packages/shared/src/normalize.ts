/**
 * Normalização e comparação de respostas.
 * Portado do jogo em HTML: mesmas regras, agora usadas pelo servidor (que decide)
 * e pelo front (que pode, por exemplo, mostrar a prévia das palavras).
 */

const STOPWORDS = /\b(o|a|os|as|um|uma|the|de|do|da|dos|das|e)\b/g;

/** Minúsculas, sem acento, sem pontuação, sem artigos/preposições curtas. */
export function norm(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(STOPWORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(\d) (?=\d)/g, '$1');
}

/** Distância de Levenshtein (edições de 1 caractere). */
export function lev(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[n]!;
}

/** Tolerância a erro de digitação conforme o tamanho da resposta. */
export function typoTolerance(length: number): number {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  return 2;
}

/** O chute bate com alguma das respostas aceitas? Números só valem se forem exatos. */
export function answerOk(guess: string, answers: readonly string[]): boolean {
  const g = norm(guess);
  if (!g) return false;
  return answers.some((answer) => {
    const t = norm(answer);
    if (!t) return false;
    if (g === t) return true;
    if (/^\d+$/.test(t) || /^\d+$/.test(g)) return false;
    return lev(g, t) <= typoTolerance(t.length);
  });
}

/** A pergunta escrita bate com a pergunta original? Tolera ~10% de diferença (mínimo 2). */
export function questionOk(guess: string, question: string): boolean {
  const g = norm(guess);
  const t = norm(question);
  if (!g || !t) return false;
  return lev(g, t) <= Math.max(2, Math.floor(t.length * 0.1));
}

/** Quebra a pergunta nas palavras que viram os quadrados numerados. */
export function splitWords(question: string): string[] {
  return question
    .trim()
    .replace(/\?+\s*$/, '')
    .split(/\s+/)
    .filter(Boolean);
}
