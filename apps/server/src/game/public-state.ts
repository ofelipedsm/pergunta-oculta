import type { PublicRoomState, PublicRound } from '@po/shared';
import type { Room } from './model';

/**
 * Único lugar que decide o que cada jogador vê.
 * Regra de ouro: quem adivinha nunca recebe a pergunta completa nem as respostas
 * enquanto a rodada está em jogo.
 */
export interface PublicExtras {
  judgeId?: string;
  skipVoteAvailable?: boolean;
  questionPool?: { total: number; unused: number };
}

export function toPublicState(room: Room, viewerId: string, extras: PublicExtras = {}): PublicRoomState {
  const { judgeId, skipVoteAvailable = false, questionPool } = extras;
  const r = room.round;
  const isMaster = !!r && r.masterId === viewerId;

  let round: PublicRound | undefined;
  if (r) {
    const ended = r.phase === 'revealed' || room.phase === 'ended';
    const answerKnown = ended || !!r.hit;
    round = {
      number: r.number,
      source: r.source,
      masterId: r.masterId,
      category: r.category,
      level: r.level,
      phase: r.phase,
      wordCount: r.words.length,
      words: r.words.map((w, i) => (ended || isMaster || r.revealed.includes(i) ? w : null)),
      revealed: [...r.revealed],
      turnPlayerId: r.turnPlayerId,
      lastOpened: r.lastOpened,
      deadline: r.deadline,
      pending: r.pending ? { kind: r.pending.kind, playerId: r.pending.playerId, text: r.pending.text } : undefined,
      hit: r.hit ? { ...r.hit } : undefined,
      lastMiss: r.lastMiss ? { ...r.lastMiss } : undefined,
      skipVoteAvailable,
      skipped: r.skipped || undefined,
      skipVote: r.skipVote
        ? { startedBy: r.skipVote.startedBy, voters: [...r.skipVote.voters], votes: { ...r.skipVote.votes } }
        : undefined,
      answer: answerKnown || isMaster ? r.answers[0] : undefined,
      question: ended || isMaster ? r.question : undefined,
      answers: isMaster ? [...r.answers] : undefined,
      log: r.log.map((l) => ({ ...l })),
    };
  }

  return {
    code: room.code,
    me: { id: viewerId, isHost: room.hostId === viewerId, isMaster },
    hostId: room.hostId,
    phase: room.phase,
    paused: !!room.paused,
    config: { ...room.config, categories: [...room.config.categories], levels: [...room.config.levels] },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      connected: p.connected,
      left: p.left,
    })),
    round,
    winnerIds: room.winnerIds ? [...room.winnerIds] : undefined,
    chat: room.chat.map((m) => ({ ...m })),
    judgeId,
    questionPool,
  };
}
