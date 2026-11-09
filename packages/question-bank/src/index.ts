import type { Category, Level, Question } from '@po/shared';
import raw from './questions.json';

export const QUESTIONS: readonly Question[] = raw as Question[];

/** Perguntas filtradas por categoria e nível. */
export function filterQuestions(categories: readonly Category[], levels: readonly Level[]): Question[] {
  return QUESTIONS.filter((q) => categories.includes(q.category) && levels.includes(q.level));
}
