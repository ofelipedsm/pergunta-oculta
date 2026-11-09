import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { QUESTIONS } from '@po/question-bank';
import type { Ack, ClientToServerEvents, ErrorCode, ServerToClientEvents, Session } from '@po/shared';
import { GameEngine } from '../game/engine';
import type { EngineDeps, EngineResult, Room, Toast } from '../game/model';
import { toPublicState } from '../game/public-state';

export type GameServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export interface SocketData {
  code?: string;
  playerId?: string;
  /** Janela do limite de envios: início e quantidade de eventos nela. */
  rateWindowStart?: number;
  rateCount?: number;
}

export interface RoomsServiceOptions {
  /** Quanto tempo o dono pode ficar fora antes de a posse passar adiante. */
  hostGraceMs: number;
  /** Sala sem ninguém conectado é removida depois disso. */
  idleRoomMs: number;
  /** Intervalo da varredura de salas abandonadas. */
  sweepEveryMs: number;
  /** Eventos por segundo aceitos por socket. */
  maxEventsPerSecond: number;
}

export const DEFAULT_ROOMS_OPTIONS: RoomsServiceOptions = {
  hostGraceMs: 30_000,
  idleRoomMs: 30 * 60_000,
  sweepEveryMs: 60_000,
  maxEventsPerSecond: 5,
};

const err = (code: ErrorCode, message: string): Ack<never> => ({ ok: false, code, message });

/**
 * Guarda as salas em memória e liga o GameEngine aos sockets.
 * O Node processa um evento por vez e nenhum handler é assíncrono, então os eventos
 * de uma sala nunca se intercalam: não é preciso fila nem lock.
 * Por guardar estado em memória, o servidor deve rodar como UMA instância.
 */
@Injectable()
export class RoomsService implements OnModuleDestroy {
  private readonly logger = new Logger(RoomsService.name);
  private readonly rooms = new Map<string, Room>();
  private readonly roundTimers = new Map<string, NodeJS.Timeout>();
  private readonly hostTimers = new Map<string, NodeJS.Timeout>();
  private readonly sweeper: NodeJS.Timeout;
  private server?: GameServer;
  readonly engine: GameEngine;
  private readonly options: RoomsServiceOptions;

  constructor(deps?: Partial<EngineDeps>, options?: Partial<RoomsServiceOptions>) {
    this.options = { ...DEFAULT_ROOMS_OPTIONS, ...options };
    this.engine = new GameEngine({
      now: () => Date.now(),
      random: () => Math.random(),
      newId: () => randomUUID(),
      newToken: () => randomBytes(24).toString('base64url'),
      questions: QUESTIONS,
      ...deps,
    });
    this.sweeper = setInterval(() => this.sweep(), this.options.sweepEveryMs);
    this.sweeper.unref();
  }

  attach(server: GameServer): void {
    this.server = server;
  }

  onModuleDestroy(): void {
    clearInterval(this.sweeper);
    for (const t of this.roundTimers.values()) clearTimeout(t);
    for (const t of this.hostTimers.values()) clearTimeout(t);
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  // ---------------------------------------------------------------- limite de envios

  /** true se o socket passou do limite de eventos por segundo. */
  isRateLimited(socket: GameSocket): boolean {
    const now = Date.now();
    const data = socket.data;
    if (!data.rateWindowStart || now - data.rateWindowStart >= 1000) {
      data.rateWindowStart = now;
      data.rateCount = 0;
    }
    data.rateCount = (data.rateCount ?? 0) + 1;
    return data.rateCount > this.options.maxEventsPerSecond;
  }

  // ---------------------------------------------------------------- entrar e sair

  create(socket: GameSocket, name: string): Ack<Session> {
    this.detach(socket);
    let code = this.engine.newRoomCode();
    while (this.rooms.has(code)) code = this.engine.newRoomCode();
    const { room, player } = this.engine.createRoom(code, name);
    this.rooms.set(code, room);
    this.bind(socket, room, player.id);
    this.logger.log(`Sala ${code} criada`);
    this.broadcast(room);
    return { ok: true, data: { code, playerId: player.id, token: player.token } };
  }

  join(
    socket: GameSocket,
    input: { code: string; name?: string; playerId?: string; token?: string },
  ): Ack<Session> {
    const room = this.rooms.get(input.code);
    if (!room) return err('ROOM_NOT_FOUND', 'Sala não encontrada');
    if (socket.data.code !== room.code || socket.data.playerId !== input.playerId) this.detach(socket);

    const res = this.engine.join(room, input);
    if (!res.ok) return res;
    const { player, reconnected } = res.data;
    this.bind(socket, room, player.id);
    if (reconnected && room.hostId === player.id) this.clearHostTimer(room.code);
    this.afterChange(room, res.toasts);
    return { ok: true, data: { code: room.code, playerId: player.id, token: player.token } };
  }

  leave(socket: GameSocket): Ack {
    const ctx = this.context(socket);
    if (!ctx.ok) return ctx.ack;
    const { room, playerId } = ctx;
    const res = this.engine.leave(room, playerId);
    for (const s of this.socketsOf(room.code, playerId)) this.unbind(s);
    if (!res.ok) return res;
    this.afterChange(room, res.toasts);
    return { ok: true };
  }

  kick(socket: GameSocket, targetId: string): Ack {
    return this.act(socket, (room, actor) => {
      const res = this.engine.kick(room, actor, targetId);
      if (res.ok) {
        for (const s of this.socketsOf(room.code, targetId)) {
          s.emit('room:closed', { reason: 'Você foi removido da sala' });
          this.unbind(s);
        }
      }
      return res;
    });
  }

  /** O socket caiu: marca o jogador como desconectado, sem tirá-lo da partida. */
  disconnect(socket: GameSocket): void {
    const { code, playerId } = socket.data;
    if (!code || !playerId) return;
    const room = this.rooms.get(code);
    if (!room) return;
    const stillOnline = this.socketsOf(code, playerId).some((s) => s.id !== socket.id);
    if (stillOnline) return;
    this.engine.setConnected(room, playerId, false);
    if (room.hostId === playerId) this.startHostTimer(room);
    this.broadcast(room);
  }

  // ---------------------------------------------------------------- ações do jogo

  /**
   * Executa uma ação do engine em nome do jogador ligado ao socket,
   * reagenda o cronômetro e manda o estado novo para a sala.
   */
  act(socket: GameSocket, fn: (room: Room, playerId: string) => EngineResult<unknown>): Ack {
    const ctx = this.context(socket);
    if (!ctx.ok) return ctx.ack;
    const res = fn(ctx.room, ctx.playerId);
    if (!res.ok) return res;
    this.afterChange(ctx.room, res.toasts);
    return { ok: true };
  }

  // ---------------------------------------------------------------- internos

  private context(
    socket: GameSocket,
  ): { ok: true; room: Room; playerId: string } | { ok: false; ack: Ack<never> } {
    const { code, playerId } = socket.data;
    const room = code ? this.rooms.get(code) : undefined;
    if (!room || !playerId) return { ok: false, ack: err('NOT_IN_ROOM', 'Você não está em uma sala') };
    return { ok: true, room, playerId };
  }

  private afterChange(room: Room, toasts: Toast[]): void {
    this.scheduleRound(room);
    for (const t of toasts) this.server?.to(room.code).emit('room:toast', t);
    this.broadcast(room);
  }

  /** Um cronômetro por sala, sempre no prazo da fase atual. */
  private scheduleRound(room: Room): void {
    const old = this.roundTimers.get(room.code);
    if (old) clearTimeout(old);
    this.roundTimers.delete(room.code);

    const deadline = room.phase === 'playing' ? room.round?.deadline : undefined;
    if (!deadline) return;
    const delay = Math.max(0, deadline - Date.now()) + 50;
    const timer = setTimeout(() => {
      this.roundTimers.delete(room.code);
      if (!this.rooms.has(room.code)) return;
      const toasts = this.engine.onTimeout(room);
      if (toasts) this.afterChange(room, toasts);
      else this.scheduleRound(room);
    }, delay);
    timer.unref();
    this.roundTimers.set(room.code, timer);
  }

  private startHostTimer(room: Room): void {
    this.clearHostTimer(room.code);
    const timer = setTimeout(() => {
      this.hostTimers.delete(room.code);
      const host = room.players.find((p) => p.id === room.hostId);
      if (!this.rooms.has(room.code) || !host || host.connected) return;
      const next = this.engine.transferHost(room);
      if (next) this.afterChange(room, [{ kind: 'info', text: `${next.name} agora é o dono da sala` }]);
    }, this.options.hostGraceMs);
    timer.unref();
    this.hostTimers.set(room.code, timer);
  }

  private clearHostTimer(code: string): void {
    const t = this.hostTimers.get(code);
    if (t) clearTimeout(t);
    this.hostTimers.delete(code);
  }

  /** Manda para cada socket da sala o estado que aquele jogador pode ver. */
  broadcast(room: Room): void {
    if (!this.server) return;
    const judgeId = room.round?.phase === 'judging' ? this.engine.judgeId(room) : undefined;
    for (const s of this.socketsIn(room.code)) {
      if (s.data.playerId) s.emit('room:state', toPublicState(room, s.data.playerId, judgeId));
    }
  }

  private bind(socket: GameSocket, room: Room, playerId: string): void {
    socket.data.code = room.code;
    socket.data.playerId = playerId;
    void socket.join(room.code);
  }

  private unbind(socket: GameSocket): void {
    if (socket.data.code) void socket.leave(socket.data.code);
    socket.data.code = undefined;
    socket.data.playerId = undefined;
  }

  /** Socket que já estava em outra sala: sai dela como se tivesse caído. */
  private detach(socket: GameSocket): void {
    if (!socket.data.code) return;
    this.disconnect(socket);
    this.unbind(socket);
  }

  private socketsIn(code: string): GameSocket[] {
    const ids = this.server?.sockets.adapter.rooms.get(code);
    if (!ids) return [];
    const out: GameSocket[] = [];
    for (const id of ids) {
      const s = this.server!.sockets.sockets.get(id);
      if (s) out.push(s);
    }
    return out;
  }

  private socketsOf(code: string, playerId: string): GameSocket[] {
    return this.socketsIn(code).filter((s) => s.data.playerId === playerId);
  }

  /** Remove salas sem ninguém conectado há mais tempo que idleRoomMs. */
  sweep(now = Date.now()): void {
    for (const [code, room] of this.rooms) {
      const anyoneOnline = room.players.some((p) => p.connected && !p.left);
      if (!anyoneOnline && now - room.lastActivity > this.options.idleRoomMs) {
        this.removeRoom(code);
      }
    }
  }

  private removeRoom(code: string): void {
    const t = this.roundTimers.get(code);
    if (t) clearTimeout(t);
    this.roundTimers.delete(code);
    this.clearHostTimer(code);
    for (const s of this.socketsIn(code)) {
      s.emit('room:closed', { reason: 'A sala foi encerrada' });
      this.unbind(s);
    }
    this.rooms.delete(code);
    this.logger.log(`Sala ${code} removida`);
  }
}
