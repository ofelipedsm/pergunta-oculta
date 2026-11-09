import type {
  ErrorCode,
  Level,
  Question,
  RoomConfig,
  RoomPhase,
  RoundPhase,
  RoundSource,
  ToastKind,
} from '@po/shared';

/**
 * Estado interno do servidor. Contém segredos (pergunta, respostas, token):
 * nunca é enviado como está. Quem decide o que cada jogador vê é toPublicState().
 */

export interface Player {
  id: string;
  /** Segredo usado para reconectar. */
  token: string;
  name: string;
  color: string;
  score: number;
  connected: boolean;
  /** Saiu durante a partida: mantém o placar, mas não joga mais. */
  left: boolean;
  joinedAt: number;
}

export interface Pending {
  kind: 'answer' | 'bonus';
  playerId: string;
  text: string;
  /** Palavras escondidas no momento do chute (vale como pontos se o juiz aceitar). */
  hiddenAtGuess: number;
}

export interface Hit {
  playerId: string;
  points: number;
  hiddenAtHit: number;
  bonusAllowed: boolean;
  bonus?: 'ok' | 'fail' | 'skipped';
  masterPoints?: number;
}

export interface Round {
  number: number;
  source: RoundSource;
  masterId?: string;
  questionId?: string;
  /** SEGREDO */
  question: string;
  /** SEGREDO, exceto as palavras já abertas */
  words: string[];
  /** SEGREDO */
  answers: string[];
  category?: string;
  level?: Level;
  phase: RoundPhase;
  revealed: number[];
  turnPlayerId?: string;
  lastOpened?: number;
  deadline?: number;
  pending?: Pending;
  hit?: Hit;
  /** Modo Banco: último erro, que o dono ainda pode validar. */
  lastMiss?: { playerId: string; text: string; points: number };
  log: { at: number; text: string }[];
}

export interface Room {
  code: string;
  hostId: string;
  phase: RoomPhase;
  config: RoomConfig;
  /** A ordem define a ordem das vezes. */
  players: Player[];
  deck: string[];
  deckPos: number;
  turnIndex: number;
  masterIndex: number;
  roundCount: number;
  round?: Round;
  winnerIds?: string[];
  /** Partida pausada por falta de jogadores conectados; guarda o tempo que restava na fase. */
  paused?: { remainingMs?: number };
  createdAt: number;
  lastActivity: number;
}

export interface Toast {
  kind: ToastKind;
  text: string;
}

export type EngineResult<T = undefined> =
  | { ok: true; toasts: Toast[]; data: T }
  | { ok: false; code: ErrorCode; message: string };

export interface EngineDeps {
  now(): number;
  /** Número em [0, 1). Injetado para os testes serem determinísticos. */
  random(): number;
  newId(): string;
  newToken(): string;
  questions: readonly Question[];
}
