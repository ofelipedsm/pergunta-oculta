/**
 * Pontos de um acerto: palavras ainda escondidas + 1.
 * Com uma palavra aberta vale o tamanho da pergunta; com tudo aberto ainda vale 1.
 */
export function pointsFor(hidden: number): number {
  return Math.max(0, hidden) + 1;
}
