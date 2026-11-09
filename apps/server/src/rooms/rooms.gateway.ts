import { Inject } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { ZodType } from 'zod';
import {
  bonusSchema,
  createRoomSchema,
  guessSchema,
  joinRoomSchema,
  judgeSchema,
  kickSchema,
  masterSubmitSchema,
  openWordSchema,
  roomConfigSchema,
  type Ack,
  type RoomConfig,
} from '@po/shared';
import { corsOrigin, isOriginAllowed } from '../cors';
import { RoomsService, type GameServer, type GameSocket } from './rooms.service';


/** Valida o payload com zod. Devolve os dados ou o erro pronto para o callback. */
function parse<T>(schema: ZodType<T>, body: unknown): { ok: true; data: T } | { ok: false; ack: Ack<never> } {
  const res = schema.safeParse(body ?? {});
  if (res.success) return { ok: true, data: res.data };
  const message = res.error.issues[0]?.message ?? 'Dados inválidos';
  return { ok: false, ack: { ok: false, code: 'INVALID', message } };
}

const limited: Ack<never> = { ok: false, code: 'RATE_LIMITED', message: 'Calma! Muitas ações seguidas' };

/**
 * Porta de entrada dos eventos. Cada handler: limite de envios, validação do payload,
 * e delega para o RoomsService. O valor retornado vira o callback de confirmação.
 */
@WebSocketGateway({
  cors: { origin: corsOrigin() },
  allowRequest: (req, done) => done(null, isOriginAllowed(req.headers.origin)),
})
export class RoomsGateway implements OnGatewayInit, OnGatewayDisconnect {
  // @Inject explícito: funciona também sem emitDecoratorMetadata (ex.: nos testes com Vitest).
  constructor(@Inject(RoomsService) private readonly rooms: RoomsService) {}

  afterInit(server: GameServer): void {
    this.rooms.attach(server);
  }

  handleDisconnect(socket: GameSocket): void {
    this.rooms.disconnect(socket);
  }

  @SubscribeMessage('room:create')
  create(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    if (this.rooms.isRateLimited(socket)) return limited;
    const input = parse(createRoomSchema, body);
    return input.ok ? this.rooms.create(socket, input.data.name) : input.ack;
  }

  @SubscribeMessage('room:join')
  join(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    if (this.rooms.isRateLimited(socket)) return limited;
    const input = parse(joinRoomSchema, body);
    return input.ok ? this.rooms.join(socket, input.data) : input.ack;
  }

  @SubscribeMessage('room:leave')
  leave(@ConnectedSocket() socket: GameSocket) {
    if (this.rooms.isRateLimited(socket)) return limited;
    return this.rooms.leave(socket);
  }

  @SubscribeMessage('room:config')
  config(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    if (this.rooms.isRateLimited(socket)) return limited;
    const input = parse(roomConfigSchema, body);
    if (!input.ok) return input.ack;
    const patch = input.data as Partial<RoomConfig>;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.updateConfig(room, actor, patch));
  }

  @SubscribeMessage('room:kick')
  kick(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    if (this.rooms.isRateLimited(socket)) return limited;
    const input = parse(kickSchema, body);
    return input.ok ? this.rooms.kick(socket, input.data.playerId) : input.ack;
  }

  @SubscribeMessage('game:start')
  start(@ConnectedSocket() socket: GameSocket) {
    if (this.rooms.isRateLimited(socket)) return limited;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.start(room, actor));
  }

  @SubscribeMessage('game:end')
  end(@ConnectedSocket() socket: GameSocket) {
    if (this.rooms.isRateLimited(socket)) return limited;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.endGame(room, actor));
  }

  @SubscribeMessage('game:restart')
  restart(@ConnectedSocket() socket: GameSocket) {
    if (this.rooms.isRateLimited(socket)) return limited;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.restart(room, actor));
  }

  @SubscribeMessage('master:submit')
  submit(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    if (this.rooms.isRateLimited(socket)) return limited;
    const input = parse(masterSubmitSchema, body);
    if (!input.ok) return input.ack;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.submitQuestion(room, actor, input.data));
  }

  @SubscribeMessage('round:open')
  open(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    if (this.rooms.isRateLimited(socket)) return limited;
    const input = parse(openWordSchema, body);
    if (!input.ok) return input.ack;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.openWord(room, actor, input.data.index));
  }

  @SubscribeMessage('round:guess')
  guess(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    if (this.rooms.isRateLimited(socket)) return limited;
    const input = parse(guessSchema, body);
    if (!input.ok) return input.ack;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.guess(room, actor, input.data.text));
  }

  @SubscribeMessage('judge:decide')
  judge(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    if (this.rooms.isRateLimited(socket)) return limited;
    const input = parse(judgeSchema, body);
    if (!input.ok) return input.ack;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.judge(room, actor, input.data.accept));
  }

  @SubscribeMessage('bonus:try')
  bonus(@ConnectedSocket() socket: GameSocket, @MessageBody() body: unknown) {
    if (this.rooms.isRateLimited(socket)) return limited;
    const input = parse(bonusSchema, body);
    if (!input.ok) return input.ack;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.tryBonus(room, actor, input.data.text));
  }

  @SubscribeMessage('bonus:skip')
  bonusSkip(@ConnectedSocket() socket: GameSocket) {
    if (this.rooms.isRateLimited(socket)) return limited;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.skipBonus(room, actor));
  }

  @SubscribeMessage('round:next')
  next(@ConnectedSocket() socket: GameSocket) {
    if (this.rooms.isRateLimited(socket)) return limited;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.nextRound(room, actor));
  }

  @SubscribeMessage('turn:skip')
  skipTurn(@ConnectedSocket() socket: GameSocket) {
    if (this.rooms.isRateLimited(socket)) return limited;
    return this.rooms.act(socket, (room, actor) => this.rooms.engine.skipTurn(room, actor));
  }
}
