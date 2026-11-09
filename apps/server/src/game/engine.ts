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
import type { EngineDeps, EngineResult, Player, Room, Round, Toast } from './model';

const COLORS = ['#ff7a8a', '#5fd0c5', '#b59cff', '#ffb86b', '#7bd88f', '#6bb8ff', '#ff9ad5', '#e8e46b'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ'; // sem I, L e O
const LOG_MAX = 30;

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
      turnIndex: 0,
      masterIndex: 0,
      roundCount: 0,
      createdAt: now,
      lastActivity: now,
    };
    return { room, player };
  }

  /** Entrada nova (só no lobby) ou reconexão com playerId + token (a qualquer momento). */
  join(
    room: Room,
    input: { name?: string; playerId?: string; token?: string },
  ): EngineResult<{ player: Player; reconnected: boolean }> {
    if (input.playerId && input.token) {
      const p = room.players.find((x) => x.id === input.playerId);
      if (p && p.token === input.token) {
        p.connected = true;
        p.left = false;
        this.touch(room);
        return { ok: true, toasts: [], data: { player: p, reconnected: true } };
      }
    }
    if (room.phase !== 'lobby') return fail('GAME_STARTED', 'A partida já começou');
    if (this.active(room).length >= LIMITS.maxPlayers) return fail('ROOM_FULL', 'A sala está cheia');
    const name = input.name?.trim();
    if (!name) return fail('INVALID', 'Informe seu nome');

    const player = this.makePlayer(this.uniqueName(room, name), room.players.length);
    room.players.push(player);
    this.touch(room);
    return {
      ok: true,
      toasts: [{ kind: 'info', text: `${player.name} entrou na sala` }],
      data: { player, reconnected: false },
    };
  }

  setConnected(room: Room, playerId: string, connected: boolean): void {
    const p = room.players.find((x) => x.id === playerId);
    if (p) p.connected = connected;
  }

  leave(room: Room, playerId: string): EngineResult {
    const p = this.player(room, playerId);
    if (!p) return fail('NOT_IN_ROOM', 'Você não está nesta sala');
    const toasts: Toast[] = [{ kind: 'info', text: `${p.name} saiu da sala` }];

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
    if (next) room.hostId = next.id;
    return next;
  }

  updateConfig(room: Room, actorId: string, patch: Partial<RoomConfig>): EngineResult {
    const check = this.requireHost(room, actorId) ?? this.requireRoomPhase(room, 'lobby');
    if (check) return check;
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
    room.deck = this.shuffle((pool.length ? pool : this.deps.questions).map((q) => q.id));
    room.deckPos = 0;
    room.turnIndex = 0;
    room.masterIndex = 0;
    room.roundCount = 0;
    room.winnerIds = undefined;
    for (const p of room.players) p.score = 0;
    room.phase = 'playing';
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
    this.log(r!, `${this.name(room, actorId)} enviou a pergunta`);
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
    this.log(r!, `${this.name(room, actorId)} abriu a palavra ${index + 1}`);
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
      this.log(r!, `${this.name(room, actorId)} chutou "${clean}". Aguardando o mestre`);
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
      this.log(r, `${this.name(room, actorId)} ${accept ? 'aceitou' : 'recusou'} "${r.pending.text}"`);
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
      this.log(r, `${this.name(room, actorId)} validou o chute "${miss.text}"`);
      return { ok: true, toasts: this.hit(room, miss.playerId, miss.points), data: undefined };
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
    this.finishGame(room);
    return { ok: true, toasts: [{ kind: 'info', text: 'Fim de jogo!' }], data: undefined };
  }

  /** Chamado pelo serviço quando round.deadline vence. Devolve null se não havia nada vencido. */
  onTimeout(room: Room): Toast[] | null {
    const r = room.round;
    if (room.phase !== 'playing' || !r?.deadline || this.deps.now() < r.deadline) return null;

    switch (r.phase) {
      case 'writing': {
        const master = this.name(room, r.masterId);
        const q = this.drawQuestion(room);
        Object.assign(r, this.bankRoundFields(q));
        r.source = 'bank';
        r.masterId = undefined;
        this.log(r, `${master} não enviou a pergunta a tempo. Usando uma do banco`);
        this.toChoosing(room);
        return [{ kind: 'info', text: `${master} não enviou a pergunta a tempo` }];
      }
      case 'choosing':
      case 'guessing':
        return r.turnPlayerId ? this.miss(room, r.turnPlayerId, null) : null;
      case 'judging':
        this.log(r, 'Tempo de julgamento esgotado: chute recusado');
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
          log: [],
        };
        this.log(room.round, `${master.name} está criando a pergunta`);
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
      log: [],
    };
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
    r.phase = 'choosing';
    r.pending = undefined;
    this.advanceTurn(room);
    r.deadline = this.deadline(room.config.turnTimeoutSec);
  }

  private advanceTurn(room: Room): void {
    const r = room.round!;
    const n = room.players.length;
    for (let k = 0; k < n; k++) {
      const idx = (room.turnIndex + k) % n;
      const p = room.players[idx]!;
      if (!p.left && p.id !== r.masterId) {
        room.turnIndex = (idx + 1) % n;
        r.turnPlayerId = p.id;
        return;
      }
    }
    r.turnPlayerId = undefined;
  }

  private nextMaster(room: Room): Player | undefined {
    const n = room.players.length;
    for (let k = 0; k < n; k++) {
      const idx = (room.masterIndex + k) % n;
      const p = room.players[idx]!;
      if (!p.left) {
        room.masterIndex = (idx + 1) % n;
        return p;
      }
    }
    return undefined;
  }

  private hit(room: Room, playerId: string, points: number): Toast[] {
    const r = room.round!;
    const p = room.players.find((x) => x.id === playerId)!;
    p.score += points;

    let masterPoints: number | undefined;
    if (r.source === 'master' && r.masterId) {
      masterPoints = Math.floor(r.revealed.length / 2);
      const master = room.players.find((x) => x.id === r.masterId);
      if (master) master.score += masterPoints;
    }

    const bonusAllowed = room.config.bonusEnabled && points >= room.config.bonusMinHidden;
    r.hit = { playerId, points, hiddenAtHit: points, bonusAllowed, masterPoints };
    r.pending = undefined;
    r.lastMiss = undefined;
    this.log(r, `${p.name} acertou e ganhou ${points} ponto${points === 1 ? '' : 's'}`);

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
    this.log(r, text === null ? `${name} perdeu a vez` : `${name} chutou "${text}" e errou`);
    const toasts: Toast[] = [
      { kind: 'miss', text: text === null ? `${name} perdeu a vez` : `${name} errou: ${text}` },
    ];

    if (hidden === 0) {
      this.log(r, 'Todas as palavras abertas e ninguém acertou');
      this.finishRound(room);
      toasts.push({ kind: 'info', text: 'Ninguém acertou' });
      return toasts;
    }
    r.lastMiss = r.source === 'bank' && text !== null ? { playerId, text, points: hidden } : undefined;
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
    this.log(r, ok ? `${p.name} acertou a pergunta: +1 ponto extra` : `${p.name} errou a pergunta`);
    this.finishRound(room);
    return ok ? [{ kind: 'hit', text: `${p.name} ganhou o ponto extra!` }] : [];
  }

  private finishRound(room: Room): void {
    const r = room.round!;
    r.phase = 'revealed';
    r.deadline = undefined;
    r.pending = undefined;
    r.lastMiss = undefined;
    this.touch(room);
  }

  private finishGame(room: Room): void {
    room.phase = 'ended';
    if (room.round) {
      room.round.deadline = undefined;
    }
    const best = Math.max(...room.players.map((p) => p.score));
    room.winnerIds = room.players.filter((p) => p.score === best).map((p) => p.id);
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
    if (this.active(room).length < LIMITS.minPlayers) {
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

  private drawQuestion(room: Room): Question {
    if (room.deckPos >= room.deck.length) {
      const pool = this.filteredPool(room.config);
      room.deck = this.shuffle((pool.length ? pool : this.deps.questions).map((q) => q.id));
      room.deckPos = 0;
    }
    const id = room.deck[room.deckPos++];
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

  private log(r: Round, text: string): void {
    r.log.unshift({ at: this.deps.now(), text });
    if (r.log.length > LOG_MAX) r.log.length = LOG_MAX;
  }

  private touch(room: Room): void {
    room.lastActivity = this.deps.now();
  }

  private active(room: Room): Player[] {
    return room.players.filter((p) => !p.left);
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
    return room.phase === 'playing' ? undefined : fail('WRONG_PHASE', 'A partida não está em andamento');
  }

  private requireRoundPhase(r: Round | undefined, phase: Round['phase']): EngineResult<never> | undefined {
    return r && r.phase === phase ? undefined : fail('WRONG_PHASE', 'Ação indisponível nesta fase');
  }

  private requireTurn(r: Round, actorId: string): EngineResult<never> | undefined {
    return r.turnPlayerId === actorId ? undefined : fail('NOT_YOUR_TURN', 'Não é a sua vez');
  }
}
