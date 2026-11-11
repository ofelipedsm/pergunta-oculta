import {
  DEFAULT_CONFIG,
  LIMITS,
  answerOk,
  questionOk,
  splitWords,
  type ErrorCode,
  type Question,
  type RoomConfig,
} from '@po/shared';
import type { ChatMessage } from '@po/shared';
import type { ChatTone, EngineDeps, EngineResult, Player, Room, Round, Toast } from './model';
import { pointsFor } from './scoring';

const COLORS = ['#ff7a8a', '#5fd0c5', '#b59cff', '#ffb86b', '#7bd88f', '#6bb8ff', '#ff9ad5', '#e8e46b'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // sem I, L e O
const LOG_MAX = 30;
/** Mestre que cai enquanto escreve: a rodada espera no máximo isso antes de usar o banco. */
export const MASTER_OFFLINE_GRACE_MS = 30_000;
/** Ao retomar uma partida pausada, a fase ganha pelo menos este tempo. */
export const RESUME_MIN_MS = 15_000;

const fail = (code: ErrorCode, message: string): EngineResult<never> => ({ ok: false, code, message });

/**
 * Regras do jogo. Cada método recebe a sala, valida quem pede e em que fase,
 * altera a sala no lugar e devolve os avisos gerados. Não conhece sockets nem timers:
 * o RoomsService chama onTimeout() quando o prazo da fase (round.deadline) vence.
 */
export class GameEngine {
  constructor(private readonly deps: EngineDeps) {}

  // ---------------------------------------------------------------- sala

  newRoomCode(): string {
    let code = '';
    for (let i = 0; i < LIMITS.roomCodeLength; i++) {
      code += CODE_ALPHABET.charAt(Math.floor(this.deps.random() * CODE_ALPHABET.length));
    }
    return code;
  }

  createRoom(code: string, hostName: string): { room: Room; player: Player } {
    const now = this.deps.now();
    const player = this.makePlayer(hostName, 0);
    const room: Room = {
      code,
      hostId: player.id,
      phase: 'lobby',
      config: { ...DEFAULT_CONFIG, categories: [...DEFAULT_CONFIG.categories], levels: [...DEFAULT_CONFIG.levels] },
      players: [player],
      deck: [],
      deckPos: 0,
      usedQuestionIds: [],
      turnIndex: 0,
      masterIndex: 0,
      roundCount: 0,
      chat: [],
      chatSeq: 0,
      createdAt: now,
      lastActivity: now,
    };
    this.log(room, `${player.name} criou a sala`);
    return { room, player };
  }

  /**
   * Reconexão com playerId + token (a qualquer momento) ou entrada nova.
   * Com a partida em andamento, quem entra começa com 0 e só joga a partir da próxima rodada
   * (se o dono permitir em lateJoin).
   */
  join(
    room: Room,
    input: { name?: string; playerId?: string; token?: string },
  ): EngineResult<{ player: Player; reconnected: boolean }> {
    if (input.playerId && input.token) {
      const p = room.players.find((x) => x.id === input.playerId);
      if (p && p.token === input.token) {
        p.left = false;
        if (!p.connected) this.log(room, `${p.name} voltou`);
        const toasts = this.setConnected(room, p.id, true);
        this.touch(room);
        return { ok: true, toasts, data: { player: p, reconnected: true } };
      }
    }
    if (room.phase !== 'lobby' && !room.config.lateJoin) {
      return fail('GAME_STARTED', 'A partida já começou e o dono não liberou entrar no meio');
    }
    if (this.active(room).length >= LIMITS.maxPlayers) return fail('ROOM_FULL', 'A sala está cheia');
    const name = input.name?.trim();
    if (!name) return fail('INVALID', 'Informe seu nome');

    const player = this.makePlayer(this.uniqueName(room, name), room.players.length);
    room.players.push(player);
    const toasts: Toast[] = [];
    if (room.phase === 'playing') {
      player.spectating = true;
      this.log(room, `${player.name} entrou na partida e joga a partir da próxima rodada`);
      // Se a partida estava pausada por falta de gente, quem chega já entra na roda.
      toasts.push(...this.updatePresence(room, player.id, true));
    } else {
      this.log(room, `${player.name} entrou na sala`);
    }
    this.touch(room);
    return { ok: true, toasts, data: { player, reconnected: false } };
  }

  /** Marca a conexão e ajusta a partida: pausa, retomada e prazo do mestre que caiu. */
  setConnected(room: Room, playerId: string, connected: boolean): Toast[] {
    const p = room.players.find((x) => x.id === playerId);
    if (!p) return [];
    p.connected = connected;
    const toasts = this.updatePresence(room, playerId, connected);
    if (!connected) toasts.push(...this.checkSkipVote(room));
    return toasts;
  }

  leave(room: Room, playerId: string): EngineResult {
    const p = this.player(room, playerId);
    if (!p) return fail('NOT_IN_ROOM', 'Você não está nesta sala');
    const toasts: Toast[] = [{ kind: 'info', text: `${p.name} saiu da sala` }];
    this.log(room, `${p.name} saiu da sala`);

    if (room.phase === 'lobby') {
      room.players = room.players.filter((x) => x.id !== playerId);
    } else {
      p.left = true;
      p.connected = false;
      toasts.push(...this.handleAbsentPlayer(room, playerId));
    }
    if (room.hostId === playerId) this.transferHost(room);
    this.touch(room);
    return { ok: true, toasts, data: undefined };
  }

  /** Passa a posse da sala para o próximo jogador ativo, de preferência conectado. */
  transferHost(room: Room): Player | undefined {
    const candidates = this.active(room).filter((p) => p.id !== room.hostId);
    const next = candidates.find((p) => p.connected) ?? candidates[0];
    if (next) {
      room.hostId = next.id;
      this.log(room, `${next.name} agora é o dono da sala`);
    }
    return next;
  }

  updateConfig(room: Room, actorId: string, patch: Partial<RoomConfig>): EngineResult {
    const check = this.requireHost(room, actorId) ?? this.requireRoomPhase(room, 'lobby');
    if (check) return check;
    const modeLabel = { bank: 'Banco', master: 'Mestre', mixed: 'Misto' } as const;
    const who = this.name(room, actorId);
    if (patch.mode && patch.mode !== room.config.mode) {
      this.log(room, `${who} mudou o modo para ${modeLabel[patch.mode]}`);
    } else if (Object.keys(patch).length) {
      this.log(room, `${who} ajustou as regras`);
    }
    room.config = { ...room.config, ...patch };
    this.touch(room);
    return { ok: true, toasts: [], data: undefined };
  }

  kick(room: Room, actorId: string, targetId: string): EngineResult {
    const check = this.requireHost(room, actorId) ?? this.requireRoomPhase(room, 'lobby');
    if (check) return check;
    if (targetId === actorId) return fail('INVALID', 'Você não pode se expulsar');
    const target = this.player(room, targetId);
    if (!target) return fail('NOT_IN_ROOM', 'Jogador não está na sala');
    room.players = room.players.filter((p) => p.id !== targetId);
    this.log(room, `${target.name} foi removido da sala`);
    return { ok: true, toasts: [{ kind: 'info', text: `${target.name} foi removido` }], data: undefined };
  }

  // ---------------------------------------------------------------- partida

  start(room: Room, actorId: string): EngineResult {
    const check = this.requireHost(room, actorId) ?? this.requireRoomPhase(room, 'lobby');
    if (check) return check;
    if (this.active(room).length < LIMITS.minPlayers) {
      return fail('NOT_ENOUGH_PLAYERS', `São necessários pelo menos ${LIMITS.minPlayers} jogadores`);
    }
    const pool = this.filteredPool(room.config);
    if (room.config.mode !== 'master' && pool.length === 0) {
      return fail('NO_QUESTIONS', 'Nenhuma pergunta com essas categorias e níveis');
    }
    this.buildDeck(room);
    room.turnIndex = 0;
    room.masterIndex = 0;
    room.roundCount = 0;
    room.winnerIds = undefined;
    for (const p of room.players) {
      p.score = 0;
      p.spectating = undefined;
    }
    room.phase = 'playing';
    this.log(room, 'A partida começou!');
    const toasts = this.startRound(room);
    this.touch(room);
    return { ok: true, toasts: [{ kind: 'info', text: 'A partida começou!' }, ...toasts], data: undefined };
  }

  submitQuestion(
    room: Room,
    actorId: string,
    input: { question: string; answers: string[]; category?: string },
  ): EngineResult {
    const r = room.round;
    const check = this.requirePlaying(room, actorId) ?? this.requireRoundPhase(r, 'writing');
    if (check) return check;
    if (r!.masterId !== actorId) return fail('NOT_MASTER', 'Só o mestre da rodada cria a pergunta');

    const words = splitWords(input.question);
    if (words.length < LIMITS.questionMinWords || words.length > LIMITS.questionMaxWords) {
      return fail(
        'INVALID',
        `A pergunta precisa ter de ${LIMITS.questionMinWords} a ${LIMITS.questionMaxWords} palavras`,
      );
    }
    const answers = input.answers.map((a) => a.trim()).filter(Boolean);
    if (!answers.length) return fail('INVALID', 'Informe pelo menos uma resposta');

    r!.question = words.join(' ');
    r!.words = words;
    r!.answers = answers;
    r!.category = input.category?.trim() || undefined;
    this.log(room, `${this.name(room, actorId)} enviou a pergunta`);
    this.toChoosing(room);
    this.touch(room);
    return { ok: true, toasts: [], data: undefined };
  }

  openWord(room: Room, actorId: string, index: number): EngineResult {
    const r = room.round;
    const check =
      this.requirePlaying(room, actorId) ?? this.requireRoundPhase(r, 'choosing') ?? this.requireTurn(r!, actorId);
    if (check) return check;
    if (!Number.isInteger(index) || index < 0 || index >= r!.words.length) {
      return fail('INVALID', 'Palavra inválida');
    }
    if (r!.revealed.includes(index)) return fail('WORD_ALREADY_OPEN', 'Essa palavra já está aberta');

    r!.revealed.push(index);
    r!.lastOpened = index;
    r!.lastMiss = undefined; // a janela de validação do dono fecha quando uma palavra nova é aberta
    r!.phase = 'guessing';
    r!.deadline = this.deadline(room.config.turnTimeoutSec);
    this.log(room, `${this.name(room, actorId)} abriu a palavra ${index + 1}: “${r!.words[index]}”`);
    this.touch(room);
    return { ok: true, toasts: [], data: undefined };
  }

  guess(room: Room, actorId: string, text: string): EngineResult {
    const r = room.round;
    const check =
      this.requirePlaying(room, actorId) ?? this.requireRoundPhase(r, 'guessing') ?? this.requireTurn(r!, actorId);
    if (check) return check;
    const clean = text.trim().slice(0, LIMITS.guessMax);
    if (!clean) return fail('INVALID', 'Digite um chute');

    const hidden = this.hidden(r!);
    if (answerOk(clean, r!.answers)) {
      return { ok: true, toasts: this.hit(room, actorId, hidden), data: undefined };
    }
    if (r!.source === 'master' && r!.masterId) {
      // No modo Mestre, todo chute não reconhecido vai para o julgamento.
      r!.pending = { kind: 'answer', playerId: actorId, text: clean, hiddenAtGuess: hidden };
      r!.phase = 'judging';
      r!.deadline = this.deadline(room.config.judgeTimeoutSec);
      this.log(room, `${this.name(room, actorId)} chutou “${clean}”. ${this.name(room, r!.masterId)} está julgando`);
      this.touch(room);
      return { ok: true, toasts: [], data: undefined };
    }
    return { ok: true, toasts: this.miss(room, actorId, clean), data: undefined };
  }

  /**
   * Modo Mestre: o juiz (mestre, ou o dono se o mestre estiver fora) decide o chute pendente.
   * Modo Banco: o dono pode validar o último erro enquanto nenhuma palavra nova foi aberta.
   */
  judge(room: Room, actorId: string, accept: boolean): EngineResult {
    const r = room.round;
    const check = this.requirePlaying(room, actorId);
    if (check) return check;
    if (!r) return fail('WRONG_PHASE', 'Não há rodada em andamento');

    if (r.phase === 'judging' && r.pending) {
      if (actorId !== this.judgeId(room)) return fail('NOT_JUDGE', 'Só o mestre decide este chute');
      if (r.pending.playerId === actorId) return fail('CANNOT_JUDGE_SELF', 'Você não pode julgar o próprio chute');
      this.log(
        room,
        `${this.name(room, actorId)} ${accept ? 'aceitou' : 'recusou'} “${r.pending.text}”`,
        accept ? 'hit' : 'miss',
      );
      return { ok: true, toasts: this.resolvePending(room, accept), data: undefined };
    }

    if (r.source === 'bank' && r.phase === 'choosing' && r.lastMiss) {
      if (actorId !== room.hostId) return fail('NOT_HOST', 'Só o dono da sala valida chutes');
      if (r.lastMiss.playerId === actorId) return fail('CANNOT_JUDGE_SELF', 'Você não pode validar o próprio chute');
      const miss = r.lastMiss;
      r.lastMiss = undefined;
      if (!accept) {
        this.touch(room);
        return { ok: true, toasts: [], data: undefined };
      }
      this.log(room, `${this.name(room, actorId)} validou o chute “${miss.text}”`, 'hit');
      return { ok: true, toasts: this.hit(room, miss.playerId, miss.hidden), data: undefined };
    }

    return fail('WRONG_PHASE', 'Não há chute para julgar agora');
  }

  tryBonus(room: Room, actorId: string, text: string): EngineResult {
    const r = room.round;
    const check = this.requirePlaying(room, actorId) ?? this.requireRoundPhase(r, 'bonus');
    if (check) return check;
    if (r!.hit?.playerId !== actorId) return fail('NOT_YOUR_TURN', 'Só quem acertou tenta o ponto extra');

    if (questionOk(text, r!.question)) return { ok: true, toasts: this.bonusResult(room, true), data: undefined };

    if (r!.source === 'master' && this.isActive(room, r!.masterId)) {
      r!.pending = { kind: 'bonus', playerId: actorId, text: text.trim(), hiddenAtGuess: r!.hit.hiddenAtHit };
      this.log(room, `${this.name(room, actorId)} tentou o ponto extra. ${this.name(room, r!.masterId)} está julgando`);
      r!.phase = 'judging';
      r!.deadline = this.deadline(room.config.judgeTimeoutSec);
      this.touch(room);
      return { ok: true, toasts: [], data: undefined };
    }
    return { ok: true, toasts: this.bonusResult(room, false), data: undefined };
  }

  skipBonus(room: Room, actorId: string): EngineResult {
    const r = room.round;
    const check = this.requirePlaying(room, actorId) ?? this.requireRoundPhase(r, 'bonus');
    if (check) return check;
    if (r!.hit?.playerId !== actorId) return fail('NOT_YOUR_TURN', 'Só quem acertou decide o ponto extra');
    r!.hit.bonus = 'skipped';
    this.log(room, `${this.name(room, actorId)} não tentou o ponto extra`);
    this.finishRound(room);
    return { ok: true, toasts: [], data: undefined };
  }

  nextRound(room: Room, actorId: string): EngineResult {
    const r = room.round;
    const check = this.requirePlaying(room, actorId) ?? this.requireRoundPhase(r, 'revealed');
    if (check) return check;
    if (actorId !== room.hostId && actorId !== r!.masterId) {
      return fail('NOT_HOST', 'Só o dono da sala ou o mestre avança');
    }
    if (this.isGameOver(room)) {
      this.finishGame(room);
      return { ok: true, toasts: [{ kind: 'info', text: 'Fim de jogo!' }], data: undefined };
    }
    const toasts = this.startRound(room);
    this.touch(room);
    return { ok: true, toasts, data: undefined };
  }

  skipTurn(room: Room, actorId: string): EngineResult {
    const r = room.round;
    const check = this.requireHost(room, actorId) ?? this.requirePlaying(room, actorId);
    if (check) return check;
    if (!r || (r.phase !== 'choosing' && r.phase !== 'guessing') || !r.turnPlayerId) {
      return fail('WRONG_PHASE', 'Não há vez para pular agora');
    }
    return { ok: true, toasts: this.miss(room, r.turnPlayerId, null), data: undefined };
  }

  endGame(room: Room, actorId: string): EngineResult {
    const check = this.requireHost(room, actorId);
    if (check) return check;
    if (room.phase !== 'playing') return fail('WRONG_PHASE', 'A partida não está em andamento');
    this.log(room, `${this.name(room, actorId)} encerrou a partida`);
    this.finishGame(room);
    return { ok: true, toasts: [{ kind: 'info', text: 'Fim de jogo!' }], data: undefined };
  }

  /** Quem adivinha pode propor pular a pergunta a qualquer momento da rodada (uma vez por volta). */
  startSkipVote(room: Room, actorId: string): EngineResult {
    const r = room.round;
    const check = this.requirePlaying(room, actorId);
    if (check) return check;
    if (!r || !this.skipVoteAvailable(room)) {
      return fail('WRONG_PHASE', 'Agora não dá para propor pular. Depois de uma recusa, só na próxima volta');
    }
    const voters = this.skipVoters(room);
    if (!voters.includes(actorId)) return fail('NOT_YOUR_TURN', 'Só quem está adivinhando vota');
    r.skipVote = { startedBy: actorId, voters, votes: { [actorId]: true } };
    this.log(room, `${this.name(room, actorId)} propôs pular a pergunta. Todos precisam aceitar`);
    return { ok: true, toasts: this.checkSkipVote(room), data: undefined };
  }

  voteSkip(room: Room, actorId: string, accept: boolean): EngineResult {
    const r = room.round;
    const check = this.requirePlaying(room, actorId);
    if (check) return check;
    if (!r?.skipVote) return fail('WRONG_PHASE', 'Não há votação aberta');
    if (!r.skipVote.voters.includes(actorId)) return fail('NOT_YOUR_TURN', 'Você não vota nesta pergunta');
    if (actorId in r.skipVote.votes) return fail('INVALID', 'Você já votou');
    r.skipVote.votes[actorId] = accept;
    if (!accept) {
      this.failSkipVote(room, `${this.name(room, actorId)} recusou`);
      this.touch(room);
      return { ok: true, toasts: [], data: undefined };
    }
    this.log(room, `${this.name(room, actorId)} aceitou pular`);
    return { ok: true, toasts: this.checkSkipVote(room), data: undefined };
  }

  /** Votação disponível: alguém está na vez de abrir ou chutar, sem votação aberta e já passou uma volta desde a última recusa. */
  skipVoteAvailable(room: Room): boolean {
    const r = room.round;
    return (
      room.phase === 'playing' &&
      !room.paused &&
      !!r &&
      r.words.length > 0 &&
      (r.phase === 'choosing' || r.phase === 'guessing') &&
      !r.skipVote &&
      r.turnsPassed >= r.nextSkipVoteAt
    );
  }

  /** Votam os jogadores conectados que estão adivinhando (o mestre e quem só assiste ficam de fora). */
  private skipVoters(room: Room): string[] {
    const masterId = room.round?.masterId;
    return this.playing(room)
      .filter((p) => p.connected && p.id !== masterId)
      .map((p) => p.id);
  }

  /** Todos os que ainda estão na sala aceitaram? Então pula sem pontos. */
  private checkSkipVote(room: Room): Toast[] {
    const r = room.round;
    const vote = r?.skipVote;
    if (!r || !vote) return [];
    const stillHere = vote.voters.filter((id) => this.isActive(room, id));
    if (stillHere.length && stillHere.every((id) => vote.votes[id] === true)) {
      r.skipVote = undefined;
      r.skipped = true;
      this.log(room, 'Todos aceitaram: pergunta pulada, ninguém pontua');
      this.finishRound(room);
      return [{ kind: 'info', text: 'Pergunta pulada' }];
    }
    return [];
  }

  /** Votação recusada ou expirada: a rodada segue e outra só depois de uma volta completa. */
  private failSkipVote(room: Room, reason: string): void {
    const r = room.round!;
    r.skipVote = undefined;
    r.nextSkipVoteAt = r.turnsPassed + Math.max(1, this.skipVoters(room).length);
    this.log(room, `Pular recusado (${reason}). Os chutes continuam; nova votação depois de uma volta`, 'miss');
  }

  /** Mensagem de um jogador no chat. Vale em qualquer fase, inclusive com a partida pausada. */
  chat(room: Room, actorId: string, text: string): EngineResult {
    const p = this.player(room, actorId);
    if (!p) return fail('NOT_IN_ROOM', 'Você não está nesta sala');
    const clean = text.replace(/\s+/g, ' ').trim().slice(0, LIMITS.chatMax);
    if (!clean) return fail('INVALID', 'Mensagem vazia');
    this.pushChat(room, { kind: 'user', playerId: p.id, text: clean });
    this.touch(room);
    return { ok: true, toasts: [], data: undefined };
  }

  /** Depois do fim de jogo: volta ao lobby com os mesmos jogadores e pontos zerados. */
  restart(room: Room, actorId: string): EngineResult {
    const check = this.requireHost(room, actorId) ?? this.requireRoomPhase(room, 'ended');
    if (check) return check;
    room.players = room.players.filter((p) => !p.left);
    for (const p of room.players) {
      p.score = 0;
      p.spectating = undefined;
    }
    room.phase = 'lobby';
    room.round = undefined;
    room.winnerIds = undefined;
    room.roundCount = 0;
    this.log(room, `${this.name(room, actorId)} voltou para o lobby. Bora de novo?`);
    this.touch(room);
    return { ok: true, toasts: [], data: undefined };
  }

  /** Chamado pelo serviço quando round.deadline vence. Devolve null se não havia nada vencido. */
  onTimeout(room: Room): Toast[] | null {
    const r = room.round;
    if (room.phase !== 'playing' || room.paused || !r?.deadline || this.deps.now() < r.deadline) return null;

    switch (r.phase) {
      case 'writing': {
        const master = this.name(room, r.masterId);
        const q = this.drawQuestion(room);
        Object.assign(r, this.bankRoundFields(q));
        r.source = 'bank';
        r.masterId = undefined;
        this.log(room, `${master} não enviou a pergunta a tempo. Usando uma do banco`);
        this.toChoosing(room);
        return [{ kind: 'info', text: `${master} não enviou a pergunta a tempo` }];
      }
      case 'choosing':
      case 'guessing':
        return r.turnPlayerId ? this.miss(room, r.turnPlayerId, null) : null;
      case 'judging':
        this.log(room, 'Tempo de julgamento esgotado: chute recusado');
        return this.resolvePending(room, false);
      case 'bonus':
        if (r.hit) r.hit.bonus = 'skipped';
        this.finishRound(room);
        return [];
      default:
        return null;
    }
  }

  /** Quem julga o chute pendente: o mestre, ou o dono da sala se o mestre estiver fora. */
  judgeId(room: Room): string {
    const r = room.round;
    const masterId = r?.masterId;
    const master = masterId ? room.players.find((p) => p.id === masterId) : undefined;
    return master && master.connected && !master.left ? master.id : room.hostId;
  }

  // ---------------------------------------------------------------- internos

  private startRound(room: Room): Toast[] {
    room.roundCount += 1;
    this.promoteSpectators(room);
    const mode = room.config.mode;
    const source = mode === 'bank' ? 'bank' : mode === 'master' ? 'master' : room.roundCount % 2 === 1 ? 'bank' : 'master';

    if (source === 'master') {
      const master = this.nextMaster(room);
      if (master) {
        room.round = {
          number: room.roundCount,
          source: 'master',
          masterId: master.id,
          question: '',
          words: [],
          answers: [],
          phase: 'writing',
          revealed: [],
          deadline: this.deadline(room.config.writeTimeoutSec),
          turnsPassed: 0,
          nextSkipVoteAt: 0,
          log: [],
        };
        this.log(room, `Rodada ${room.roundCount}: ${master.name} é o mestre e está criando a pergunta`);
        return [{ kind: 'info', text: `Rodada ${room.roundCount}: ${master.name} é o mestre` }];
      }
    }

    const q = this.drawQuestion(room);
    room.round = {
      number: room.roundCount,
      source: 'bank',
      ...this.bankRoundFields(q),
      phase: 'choosing',
      revealed: [],
      turnsPassed: 0,
      nextSkipVoteAt: 0,
      log: [],
    };
    const levelLabel = { 1: 'fácil', 2: 'médio', 3: 'difícil' } as const;
    this.log(
      room,
      `Rodada ${room.roundCount}: ${q.category}, ${levelLabel[q.level]}, ${room.round.words.length} palavras`,
    );
    this.toChoosing(room);
    return [];
  }

  private bankRoundFields(q: Question) {
    const words = splitWords(q.question);
    return {
      questionId: q.id,
      question: words.join(' '),
      words,
      answers: [...q.answers],
      category: q.category as string,
      level: q.level,
    };
  }

  /** Passa a vez para o próximo jogador elegível e abre a fase de escolha. */
  private toChoosing(room: Room): void {
    const r = room.round!;
    // Com todas as palavras abertas não há o que escolher: a vez é só para chutar.
    r.phase = this.hidden(r) === 0 && r.words.length > 0 ? 'guessing' : 'choosing';
    r.pending = undefined;
    this.advanceTurn(room);
    r.deadline = this.deadline(room.config.turnTimeoutSec);
  }

  /** Próximo jogador na ordem, pulando o mestre e, se possível, quem está desconectado. */
  private advanceTurn(room: Room): void {
    const r = room.round!;
    const n = room.players.length;
    for (const onlyConnected of [true, false]) {
      for (let k = 0; k < n; k++) {
        const idx = (room.turnIndex + k) % n;
        const p = room.players[idx]!;
        if (p.left || p.spectating || p.id === r.masterId || (onlyConnected && !p.connected)) continue;
        room.turnIndex = (idx + 1) % n;
        r.turnPlayerId = p.id;
        this.log(room, `Vez de ${p.name}`);
        return;
      }
    }
    r.turnPlayerId = undefined;
  }

  /**
   * Com menos de 2 jogadores conectados, a partida pausa e o cronômetro congela.
   * Quando volta a ter 2, retoma com o tempo que restava (no mínimo RESUME_MIN_MS).
   */
  private updatePresence(room: Room, playerId: string, connected: boolean): Toast[] {
    if (room.phase !== 'playing') return [];
    const r = room.round;
    const now = this.deps.now();
    const toasts: Toast[] = [];
    let online = this.playing(room).filter((p) => p.connected).length;
    // Faltou gente para jogar e há quem esteja só assistindo: entra na rodada atual mesmo.
    if (online < LIMITS.minPlayers && this.promoteSpectators(room, true)) {
      online = this.playing(room).filter((p) => p.connected).length;
    }

    if (online < LIMITS.minPlayers && !room.paused) {
      room.paused = { remainingMs: r?.deadline ? Math.max(0, r.deadline - now) : undefined };
      if (r) {
        r.deadline = undefined;
        this.log(room, 'Partida pausada: aguardando jogadores');
      }
      toasts.push({ kind: 'info', text: 'Partida pausada: aguardando jogadores' });
    } else if (online >= LIMITS.minPlayers && room.paused) {
      const remaining = room.paused.remainingMs;
      room.paused = undefined;
      if (r && remaining !== undefined) r.deadline = now + Math.max(remaining, RESUME_MIN_MS);
      if (r) this.log(room, 'Partida retomada');
      toasts.push({ kind: 'info', text: 'Partida retomada' });
    }

    // Mestre caiu enquanto escrevia: não segura todo mundo pelo prazo inteiro.
    if (!connected && !room.paused && r?.phase === 'writing' && r.masterId === playerId) {
      r.deadline = Math.min(r.deadline ?? Infinity, now + MASTER_OFFLINE_GRACE_MS);
    }
    return toasts;
  }

  private nextMaster(room: Room): Player | undefined {
    const n = room.players.length;
    for (let k = 0; k < n; k++) {
      const idx = (room.masterIndex + k) % n;
      const p = room.players[idx]!;
      if (!p.left && !p.spectating) {
        room.masterIndex = (idx + 1) % n;
        return p;
      }
    }
    return undefined;
  }

  /** Acerto com `hidden` palavras ainda escondidas: vale hidden + 1 pontos. */
  private hit(room: Room, playerId: string, hidden: number): Toast[] {
    const r = room.round!;
    const p = room.players.find((x) => x.id === playerId)!;
    const points = pointsFor(hidden);
    p.score += points;

    let masterPoints: number | undefined;
    if (r.source === 'master' && r.masterId) {
      masterPoints = Math.floor(r.revealed.length / 2);
      const master = room.players.find((x) => x.id === r.masterId);
      if (master) master.score += masterPoints;
    }

    const bonusAllowed = room.config.bonusEnabled && hidden >= room.config.bonusMinHidden;
    r.hit = { playerId, points, hiddenAtHit: hidden, bonusAllowed, masterPoints };
    r.pending = undefined;
    r.lastMiss = undefined;
    this.log(
      room,
      `${p.name} acertou: “${r.answers[0]}” e ganhou ${points} ponto${points === 1 ? '' : 's'}`,
      'hit',
    );
    if (masterPoints !== undefined) {
      this.log(room, `${this.name(room, r.masterId)} (mestre) ganhou ${masterPoints} ponto${masterPoints === 1 ? '' : 's'}`);
    }
    if (bonusAllowed) this.log(room, `${p.name} pode tentar o ponto extra escrevendo a pergunta`);

    if (bonusAllowed) {
      r.phase = 'bonus';
      r.deadline = this.deadline(room.config.turnTimeoutSec);
    } else {
      this.finishRound(room);
    }
    this.touch(room);
    return [{ kind: 'hit', text: `${p.name} acertou! +${points}` }];
  }

  /** Chute errado (ou vez estourada, com text = null). */
  private miss(room: Room, playerId: string, text: string | null): Toast[] {
    const r = room.round!;
    const name = this.name(room, playerId);
    const hidden = this.hidden(r);
    r.pending = undefined;
    this.log(room, text === null ? `${name} perdeu a vez` : `${name} chutou “${text}” e errou`, 'miss');
    const toasts: Toast[] = [
      { kind: 'miss', text: text === null ? `${name} perdeu a vez` : `${name} errou: ${text}` },
    ];

    r.turnsPassed += 1;
    if (r.skipVote) this.failSkipVote(room, 'a vez passou sem todos aceitarem');
    // Tudo aberto: a rodada segue em voltas de chute (valendo 1) até alguém acertar ou todos pularem.
    r.lastMiss = hidden > 0 && r.source === 'bank' && text !== null ? { playerId, text, hidden } : undefined;
    this.toChoosing(room);
    this.touch(room);
    return toasts;
  }

  private resolvePending(room: Room, accept: boolean): Toast[] {
    const r = room.round!;
    const pending = r.pending;
    if (!pending) return [];
    r.pending = undefined;
    if (pending.kind === 'bonus') {
      r.phase = 'bonus';
      return this.bonusResult(room, accept);
    }
    if (accept) return this.hit(room, pending.playerId, pending.hiddenAtGuess);
    return this.miss(room, pending.playerId, pending.text);
  }

  private bonusResult(room: Room, ok: boolean): Toast[] {
    const r = room.round!;
    const hit = r.hit!;
    const p = room.players.find((x) => x.id === hit.playerId)!;
    hit.bonus = ok ? 'ok' : 'fail';
    if (ok) p.score += 1;
    this.log(room, ok ? `${p.name} acertou a pergunta: +1 ponto extra` : `${p.name} errou a pergunta`, ok ? 'hit' : 'miss');
    this.finishRound(room);
    return ok ? [{ kind: 'hit', text: `${p.name} ganhou o ponto extra!` }] : [];
  }

  private finishRound(room: Room): void {
    const r = room.round!;
    // Só aqui a pergunta inteira pode aparecer no chat.
    this.log(room, `Fim da rodada. Pergunta: “${r.question}?” Resposta: ${r.answers[0]}`);
    r.phase = 'revealed';
    r.skipVote = undefined;
    r.deadline = undefined;
    r.pending = undefined;
    r.lastMiss = undefined;
    this.touch(room);
  }

  private finishGame(room: Room): void {
    room.phase = 'ended';
    room.paused = undefined;
    if (room.round) {
      room.round.deadline = undefined;
    }
    const best = Math.max(...room.players.map((p) => p.score));
    room.winnerIds = room.players.filter((p) => p.score === best).map((p) => p.id);
    const names = room.winnerIds.map((id) => this.name(room, id));
    this.log(
      room,
      names.length === 1 ? `Fim de jogo! ${names[0]} venceu com ${best} pontos` : `Fim de jogo! Empate entre ${names.join(' e ')}`,
      'hit',
    );
    this.touch(room);
  }

  private isGameOver(room: Room): boolean {
    const { endBy, target } = room.config;
    if (endBy === 'rounds') return room.roundCount >= target;
    return room.players.some((p) => p.score >= target);
  }

  /** O jogador saiu: resolve o que dependia dele para a partida não travar. */
  private handleAbsentPlayer(room: Room, playerId: string): Toast[] {
    const r = room.round;
    if (room.phase !== 'playing' || !r) return [];
    if (this.playing(room).length < LIMITS.minPlayers) this.promoteSpectators(room, true);
    if (this.playing(room).length < LIMITS.minPlayers) {
      this.finishGame(room);
      return [{ kind: 'info', text: 'Jogadores insuficientes. Fim de jogo' }];
    }
    if ((r.phase === 'choosing' || r.phase === 'guessing') && r.turnPlayerId === playerId) {
      return this.miss(room, playerId, null);
    }
    if (r.phase === 'writing' && r.masterId === playerId) {
      r.deadline = this.deps.now();
      return this.onTimeout(room) ?? [];
    }
    if (r.phase === 'bonus' && r.hit?.playerId === playerId) {
      r.hit.bonus = 'skipped';
      this.finishRound(room);
    }
    return [];
  }

  /**
   * Monta o baralho com as perguntas do filtro que ainda não saíram nesta sala.
   * Se todas já saíram, libera de novo as desse filtro e avisa no chat.
   */
  private buildDeck(room: Room): void {
    const pool = this.filteredPool(room.config);
    const source = pool.length ? pool : this.deps.questions;
    const used = new Set(room.usedQuestionIds);
    let fresh = source.filter((q) => !used.has(q.id));
    if (!fresh.length) {
      const ids = new Set(source.map((q) => q.id));
      room.usedQuestionIds = room.usedQuestionIds.filter((id) => !ids.has(id));
      fresh = [...source];
      this.log(room, 'Todas as perguntas desta seleção já saíram nesta sala. O baralho recomeça');
    }
    room.deck = this.shuffle(fresh.map((q) => q.id));
    room.deckPos = 0;
  }

  /** Quantas perguntas da seleção atual ainda não saíram nesta sala. */
  unusedCount(room: Room): { total: number; unused: number } {
    const pool = this.filteredPool(room.config);
    const used = new Set(room.usedQuestionIds);
    return { total: pool.length, unused: pool.filter((q) => !used.has(q.id)).length };
  }

  private drawQuestion(room: Room): Question {
    // Pula as que já saíram (pode acontecer se o filtro mudou entre partidas).
    const used = new Set(room.usedQuestionIds);
    while (room.deckPos < room.deck.length && used.has(room.deck[room.deckPos]!)) room.deckPos++;
    if (room.deckPos >= room.deck.length) this.buildDeck(room);
    const id = room.deck[room.deckPos++]!;
    room.usedQuestionIds.push(id);
    return this.deps.questions.find((q) => q.id === id) ?? this.deps.questions[0]!;
  }

  private filteredPool(config: RoomConfig): Question[] {
    return this.deps.questions.filter(
      (q) => config.categories.includes(q.category) && config.levels.includes(q.level),
    );
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.deps.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  private makePlayer(name: string, index: number): Player {
    return {
      id: this.deps.newId(),
      token: this.deps.newToken(),
      name: name.trim().slice(0, LIMITS.nameMax),
      color: COLORS[index % COLORS.length]!,
      score: 0,
      connected: true,
      left: false,
      joinedAt: this.deps.now(),
    };
  }

  private uniqueName(room: Room, name: string): string {
    const base = name.slice(0, LIMITS.nameMax - 2);
    const taken = new Set(room.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name.slice(0, LIMITS.nameMax);
    for (let i = 2; ; i++) {
      const candidate = `${base} ${i}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  private hidden(r: Round): number {
    return r.words.length - r.revealed.length;
  }

  private deadline(seconds: number): number {
    return this.deps.now() + seconds * 1000;
  }

  /**
   * Registra um acontecimento: vai para o histórico da rodada e para o chat como mensagem
   * automática. Cuidado: nada aqui pode revelar a pergunta ou a resposta antes da hora.
   */
  private log(room: Room, text: string, tone: ChatTone = 'info'): void {
    const r = room.round;
    if (r) {
      r.log.unshift({ at: this.deps.now(), text });
      if (r.log.length > LOG_MAX) r.log.length = LOG_MAX;
    }
    this.pushChat(room, { kind: 'system', text, tone });
  }

  private pushChat(room: Room, msg: Omit<ChatMessage, 'id' | 'at'>): void {
    room.chatSeq += 1;
    room.chat.push({ id: room.chatSeq, at: this.deps.now(), ...msg });
    if (room.chat.length > LIMITS.chatHistory) room.chat.splice(0, room.chat.length - LIMITS.chatHistory);
  }

  private touch(room: Room): void {
    room.lastActivity = this.deps.now();
  }

  private active(room: Room): Player[] {
    return room.players.filter((p) => !p.left);
  }

  /** Jogadores na sala que já estão jogando (fora quem só assiste até a próxima rodada). */
  private playing(room: Room): Player[] {
    return room.players.filter((p) => !p.left && !p.spectating);
  }

  /** Quem entrou no meio passa a jogar. Devolve true se alguém foi promovido. */
  private promoteSpectators(room: Room, midRound = false): boolean {
    const waiting = room.players.filter((p) => p.spectating && !p.left);
    for (const p of waiting) p.spectating = undefined;
    if (waiting.length && midRound) {
      this.log(room, `${waiting.map((p) => p.name).join(', ')} já entra${waiting.length > 1 ? 'm' : ''} nesta rodada`);
    }
    return waiting.length > 0;
  }

  private isActive(room: Room, id: string | undefined): boolean {
    const p = id ? room.players.find((x) => x.id === id) : undefined;
    return !!p && p.connected && !p.left;
  }

  private player(room: Room, id: string): Player | undefined {
    return room.players.find((p) => p.id === id && !p.left);
  }

  private name(room: Room, id: string | undefined): string {
    return room.players.find((p) => p.id === id)?.name ?? 'Alguém';
  }

  // ---------------------------------------------------------------- validações

  private requireHost(room: Room, actorId: string): EngineResult<never> | undefined {
    if (!this.player(room, actorId)) return fail('NOT_IN_ROOM', 'Você não está nesta sala');
    if (room.hostId !== actorId) return fail('NOT_HOST', 'Só o dono da sala pode fazer isso');
    return undefined;
  }

  private requireRoomPhase(room: Room, phase: Room['phase']): EngineResult<never> | undefined {
    return room.phase === phase ? undefined : fail('WRONG_PHASE', 'Ação indisponível agora');
  }

  private requirePlaying(room: Room, actorId: string): EngineResult<never> | undefined {
    if (!this.player(room, actorId)) return fail('NOT_IN_ROOM', 'Você não está nesta sala');
    if (room.phase !== 'playing') return fail('WRONG_PHASE', 'A partida não está em andamento');
    if (room.paused) return fail('WRONG_PHASE', 'Partida pausada: aguardando jogadores');
    return undefined;
  }

  private requireRoundPhase(r: Round | undefined, phase: Round['phase']): EngineResult<never> | undefined {
    return r && r.phase === phase ? undefined : fail('WRONG_PHASE', 'Ação indisponível nesta fase');
  }

  private requireTurn(r: Round, actorId: string): EngineResult<never> | undefined {
    return r.turnPlayerId === actorId ? undefined : fail('NOT_YOUR_TURN', 'Não é a sua vez');
  }
}
