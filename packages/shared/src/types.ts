/** Tipos de domínio compartilhados. Nada aqui pode conter segredo da rodada. */

export type Level = 1 | 2 | 3;
export type GameMode = 'bank' | 'master' | 'mixed';
export type RoomPhase = 'lobby' | 'playing' | 'ended';
export type RoundPhase = 'writing' | 'choosing' | 'guessing' | 'judging' | 'bonus' | 'revealed';
export type RoundSource = 'bank' | 'master';
export type EndBy = 'score' | 'rounds';

export const CATEGORIES = [
  'Geografia',
  'História',
  'Ciência',
  'Animais',
  'Esportes',
  'Música',
  'Cinema e TV',
  'Comida e Bebida',
  'Tecnologia',
  'Corpo Humano',
  'Brasil',
  'Natureza',
  'Profissões',
  'Marcas e Produtos',
  'Infância',
  'Folclore e Mitologia',
  'Jogos e Videogames',
  'Matemática',
  'Língua Portuguesa',
  'Datas e Festas',
  'Transportes',
  'Casa e Objetos',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const LEVEL_LABEL: Record<Level, string> = { 1: 'Fácil', 2: 'Médio', 3: 'Difícil' };

/** Pergunta do banco. Só o servidor importa o banco completo. */
export interface Question {
  id: string;
  category: Category;
  level: Level;
  question: string;
  answers: string[];
}

export interface RoomConfig {
  mode: GameMode;
  categories: Category[];
  levels: Level[];
  bonusEnabled: boolean;
  /** Ponto extra só vale se, no acerto, faltarem pelo menos N palavras escondidas. */
  bonusMinHidden: number;
  turnTimeoutSec: number;
  writeTimeoutSec: number;
  judgeTimeoutSec: number;
  endBy: EndBy;
  /** Meta de pontos (endBy = score) ou número de rodadas (endBy = rounds). */
  target: number;
}

export const LIMITS = {
  maxPlayers: 8,
  minPlayers: 2,
  nameMax: 18,
  guessMax: 80,
  questionMinWords: 5,
  questionMaxWords: 30,
  questionMaxChars: 240,
  answersMax: 5,
  answerMax: 60,
  roomCodeLength: 4,
  chatMax: 200,
  chatHistory: 120,
} as const;

export const DEFAULT_CONFIG: RoomConfig = {
  mode: 'bank',
  categories: [...CATEGORIES],
  levels: [1, 2],
  bonusEnabled: true,
  bonusMinHidden: 3,
  turnTimeoutSec: 60,
  writeTimeoutSec: 180,
  judgeTimeoutSec: 20,
  endBy: 'score',
  target: 50,
};

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  score: number;
  connected: boolean;
  left: boolean;
}

export interface PublicHit {
  playerId: string;
  points: number;
  hiddenAtHit: number;
  bonusAllowed: boolean;
  /** Resultado do ponto extra, quando houve tentativa. */
  bonus?: 'ok' | 'fail' | 'skipped';
  masterPoints?: number;
}

export interface PublicPending {
  kind: 'answer' | 'bonus';
  playerId: string;
  text: string;
}

/** Votação para pular a pergunta quando todas as palavras já estão abertas. */
export interface PublicSkipVote {
  startedBy: string;
  /** Quem vota: os jogadores que estão adivinhando (o mestre não vota). */
  voters: string[];
  /** true = aceitou pular, false = recusou. Quem ainda não votou não aparece. */
  votes: Record<string, boolean>;
}

export interface PublicRound {
  number: number;
  source: RoundSource;
  masterId?: string;
  category?: string;
  level?: Level;
  phase: RoundPhase;
  wordCount: number;
  /** Palavra aberta ou null quando escondida. O mestre recebe todas. */
  words: (string | null)[];
  /** Índices das palavras já abertas na rodada. */
  revealed: number[];
  turnPlayerId?: string;
  lastOpened?: number;
  /** Epoch ms do prazo da fase atual, só para desenhar o cronômetro. */
  deadline?: number;
  pending?: PublicPending;
  hit?: PublicHit;
  /** Todas as palavras abertas: qualquer um que adivinha pode propor pular agora. */
  skipVoteAvailable: boolean;
  skipVote?: PublicSkipVote;
  /** A rodada terminou porque todos aceitaram pular. */
  skipped?: boolean;
  /** No modo Banco: último chute errado, que o dono ainda pode validar. */
  lastMiss?: { playerId: string; text: string; points: number };
  /** Resposta principal: só depois do acerto ou no fim da rodada. */
  answer?: string;
  /** Pergunta completa: só no fim da rodada, ou sempre para o mestre. */
  question?: string;
  /** Respostas aceitas: só para o mestre. */
  answers?: string[];
  log: { at: number; text: string }[];
}

export type ChatTone = 'info' | 'hit' | 'miss';

/** Mensagem do chat da sala: de um jogador ou automática do jogo (kind = system). */
export interface ChatMessage {
  id: number;
  at: number;
  kind: 'user' | 'system';
  playerId?: string;
  text: string;
  tone?: ChatTone;
}

export interface PublicRoomState {
  code: string;
  me: { id: string; isHost: boolean; isMaster: boolean };
  hostId: string;
  phase: RoomPhase;
  /** Menos de 2 jogadores conectados: cronômetro congelado até alguém voltar. */
  paused: boolean;
  config: RoomConfig;
  players: PublicPlayer[];
  round?: PublicRound;
  winnerIds?: string[];
  /** Perguntas do banco na seleção atual e quantas ainda não saíram nesta sala. */
  questionPool?: { total: number; unused: number };
  /** Histórico do chat da sala (mais antigas primeiro). */
  chat: ChatMessage[];
  /** Quem decide o chute pendente agora (mestre, ou o dono se o mestre estiver fora). */
  judgeId?: string;
}
