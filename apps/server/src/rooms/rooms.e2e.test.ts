import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  ClientToServerEvents,
  PublicRoomState,
  ServerToClientEvents,
  Session,
} from '@po/shared';
import { HealthController } from '../health.controller';
import { RoomsGateway } from './rooms.gateway';
import { RoomsService } from './rooms.service';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

@Module({
  providers: [
    {
      provide: RoomsService,
      useFactory: () => new RoomsService({}, { hostGraceMs: 300, maxEventsPerSecond: 50 }),
    },
    RoomsGateway,
  ],
  controllers: [HealthController],
})
class TestModule {}

let app: INestApplication;
let url: string;
let service: RoomsService;
const clients: Client[] = [];

beforeAll(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0);
  const addr = app.getHttpServer().address();
  url = `http://127.0.0.1:${addr.port}`;
  service = app.get(RoomsService);
});

afterEach(() => {
  for (const c of clients.splice(0)) c.disconnect();
});

afterAll(async () => {
  await app.close();
});

/** Cliente que guarda o último room:state recebido. */
async function connect(): Promise<Client & { state?: PublicRoomState }> {
  const c = io(url, { transports: ['websocket'], forceNew: true }) as Client & { state?: PublicRoomState };
  c.on('room:state', (s) => {
    c.state = s;
  });
  clients.push(c);
  await new Promise<void>((resolve, reject) => {
    c.once('connect', () => resolve());
    c.once('connect_error', reject);
  });
  return c;
}

/** Emite e espera a confirmação; falha o teste se o servidor recusar. */
async function call<T = undefined>(c: Client, event: string, payload?: unknown): Promise<T> {
  const res = (await (payload === undefined
    ? (c as unknown as Socket).emitWithAck(event)
    : (c as unknown as Socket).emitWithAck(event, payload))) as Ack<T>;
  if (!res.ok) throw new Error(`${event}: ${res.code} ${res.message}`);
  return (res as { data: T }).data;
}

async function tryCall(c: Client, event: string, payload?: unknown): Promise<Ack<unknown>> {
  return (await (payload === undefined
    ? (c as unknown as Socket).emitWithAck(event)
    : (c as unknown as Socket).emitWithAck(event, payload))) as Ack<unknown>;
}

/** Espera até o estado do cliente satisfazer a condição. */
async function until(c: { state?: PublicRoomState }, check: (s: PublicRoomState) => boolean, ms = 2000) {
  const start = Date.now();
  while (!(c.state && check(c.state))) {
    if (Date.now() - start > ms) throw new Error(`Estado esperado não chegou: ${JSON.stringify(c.state)}`);
    await new Promise((r) => setTimeout(r, 10));
  }
  return c.state!;
}

/** Ana cria a sala, Bia e Caio entram. */
async function threePlayers() {
  const ana = await connect();
  const bia = await connect();
  const caio = await connect();
  const sAna = await call<Session>(ana, 'room:create', { name: 'Ana' });
  const sBia = await call<Session>(bia, 'room:join', { code: sAna.code, name: 'Bia' });
  const sCaio = await call<Session>(caio, 'room:join', { code: sAna.code, name: 'Caio' });
  await until(ana, (s) => s.players.length === 3);
  return { ana, bia, caio, sAna, sBia, sCaio };
}

describe('servidor em tempo real', () => {
  it('responde no /health', async () => {
    const res = await fetch(`${url}/health`);
    const body = (await res.json()) as { ok: boolean; questions: number };
    expect(body.ok).toBe(true);
    expect(body.questions).toBeGreaterThan(300);
  });

  it('valida o payload antes de chegar ao jogo', async () => {
    const c = await connect();
    const res = await tryCall(c, 'room:create', { name: '' });
    expect(res).toMatchObject({ ok: false, code: 'INVALID' });
    const res2 = await tryCall(c, 'room:join', { code: 'ZZZZ', name: 'X' });
    expect(res2).toMatchObject({ ok: false, code: 'ROOM_NOT_FOUND' });
  });

  it('joga uma rodada do modo Banco com três celulares', async () => {
    const { ana, bia, caio, sAna, sBia } = await threePlayers();
    await call(ana, 'room:config', { bonusEnabled: false });
    await call(ana, 'game:start');
    const s0 = await until(bia, (s) => s.phase === 'playing' && s.round?.phase === 'choosing');
    expect(s0.round?.turnPlayerId).toBe(sAna.playerId);

    // fora da vez: recusado
    expect(await tryCall(bia, 'round:open', { index: 0 })).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });

    // Ana abre e erra
    await call(ana, 'round:open', { index: 0 });
    await call(ana, 'round:guess', { text: 'resposta que não existe' });
    const s1 = await until(caio, (s) => s.round?.turnPlayerId === sBia.playerId);
    expect(s1.round?.words.filter((w) => w !== null)).toHaveLength(1);
    // quem adivinha não recebe pergunta nem respostas
    expect(s1.round?.question).toBeUndefined();
    expect(s1.round?.answers).toBeUndefined();

    // Bia acerta usando a resposta que o servidor guarda
    const room = service.getRoom(sAna.code)!;
    await call(bia, 'round:open', { index: 1 });
    await call(bia, 'round:guess', { text: room.round!.answers[0] });
    const s2 = await until(ana, (s) => s.round?.phase === 'revealed');
    const words = room.round!.words.length;
    expect(s2.players.find((p) => p.id === sBia.playerId)?.score).toBe(words - 2);
    expect(s2.round?.question).toBe(room.round!.question);
  });

  it('modo Mestre: o mestre vê tudo e julga o chute pelo próprio celular', async () => {
    const { ana, bia, caio, sBia, sCaio } = await threePlayers();
    await call(ana, 'room:config', { mode: 'master', bonusEnabled: false });
    await call(ana, 'game:start');
    await until(ana, (s) => s.round?.phase === 'writing' && s.me.isMaster);
    expect(
      await tryCall(bia, 'master:submit', { question: 'Qual fruta amarela o macaco come', answers: ['banana'] }),
    ).toMatchObject({ ok: false });
    await call(ana, 'master:submit', { question: 'Qual fruta amarela o macaco adora comer', answers: ['banana'] });

    const masterView = await until(ana, (s) => s.round?.phase === 'choosing');
    expect(masterView.round?.answers).toEqual(['banana']);
    const guesserView = await until(bia, (s) => s.round?.phase === 'choosing');
    expect(guesserView.round?.answers).toBeUndefined();
    expect(guesserView.round?.words.every((w) => w === null)).toBe(true);

    await call(bia, 'round:open', { index: 0 });
    await call(bia, 'round:guess', { text: 'banana prata' });
    const judging = await until(caio, (s) => s.round?.phase === 'judging');
    expect(judging.round?.pending?.text).toBe('banana prata');
    expect(judging.judgeId).toBeDefined();

    expect(await tryCall(caio, 'judge:decide', { accept: true })).toMatchObject({ ok: false, code: 'NOT_JUDGE' });
    await call(ana, 'judge:decide', { accept: true });
    const done = await until(caio, (s) => s.round?.phase === 'revealed');
    expect(done.players.find((p) => p.id === sBia.playerId)?.score).toBe(6);
    expect(done.players.find((p) => p.id === sCaio.playerId)?.score).toBe(0);
  });

  it('reconecta com playerId e token e mantém os pontos', async () => {
    const { ana, bia, sAna, sBia } = await threePlayers();
    await call(ana, 'game:start');
    await until(bia, (s) => s.phase === 'playing');
    bia.disconnect();
    await until(ana, (s) => s.players.find((p) => p.id === sBia.playerId)?.connected === false);

    const bia2 = await connect();
    expect(await tryCall(bia2, 'room:join', { code: sAna.code, playerId: sBia.playerId, token: 'errado' })).toMatchObject({
      ok: false,
      code: 'GAME_STARTED',
    });
    await call(bia2, 'room:join', { code: sAna.code, playerId: sBia.playerId, token: sBia.token });
    const s = await until(bia2, (st) => st.phase === 'playing');
    expect(s.me.id).toBe(sBia.playerId);
    await until(ana, (st) => st.players.find((p) => p.id === sBia.playerId)?.connected === true);
  });

  it('dono fora do ar perde a posse depois do prazo', async () => {
    const { ana, bia, sBia } = await threePlayers();
    await call(ana, 'game:start');
    ana.disconnect();
    const s = await until(bia, (st) => st.hostId === sBia.playerId, 3000);
    expect(s.me.isHost).toBe(true);
  });

  it('dono remove um jogador no lobby', async () => {
    const { ana, caio, sCaio } = await threePlayers();
    const closed = new Promise<string>((resolve) => caio.once('room:closed', (i) => resolve(i.reason)));
    await call(ana, 'room:kick', { playerId: sCaio.playerId });
    expect(await closed).toContain('removido');
    await until(ana, (s) => s.players.length === 2);
  });
});

describe('chat pelo socket', () => {
  it('mensagem de um jogador chega aos outros, junto com as automáticas', async () => {
    const ana = await connect();
    const bia = await connect();
    const sAna = await call<Session>(ana, 'room:create', { name: 'Ana' });
    await call<Session>(bia, 'room:join', { code: sAna.code, name: 'Bia' });
    await call(bia, 'chat:send', { text: 'bora modo Mestre!' });
    const s = await until(ana, (st) => st.chat.some((m) => m.kind === 'user' && m.text === 'bora modo Mestre!'));
    expect(s.chat.some((m) => m.kind === 'system' && m.text === 'Bia entrou na sala')).toBe(true);
    expect(await tryCall(bia, 'chat:send', { text: '' })).toMatchObject({ ok: false, code: 'INVALID' });
  });
});

describe('limpeza de salas', () => {
  it('remove só salas sem ninguém conectado há mais tempo que o limite', () => {
    const svc = new RoomsService({}, { idleRoomMs: 1000, sweepEveryMs: 1_000_000 });
    const fake = () => ({ data: {}, join: () => undefined, leave: () => undefined }) as never;
    const a = svc.create(fake(), 'Ana');
    const b = svc.create(fake(), 'Bia');
    if (!a.ok || !b.ok) throw new Error('falhou ao criar');
    const roomA = svc.getRoom(a.data.code)!;
    roomA.players[0]!.connected = false;
    const later = Date.now() + 5000;
    svc.sweep(later);
    expect(svc.getRoom(a.data.code)).toBeUndefined();
    expect(svc.getRoom(b.data.code)).toBeDefined(); // Bia continua conectada
    svc.onModuleDestroy();
  });
});

describe('pausa pelo socket', () => {
  it('pausa quando sobra 1 conectado e retoma quando o outro volta', async () => {
    const ana = await connect();
    const bia = await connect();
    const sAna = await call<Session>(ana, 'room:create', { name: 'Ana' });
    const sBia = await call<Session>(bia, 'room:join', { code: sAna.code, name: 'Bia' });
    await call(ana, 'game:start');
    bia.disconnect();
    await until(ana, (s) => s.paused === true);
    const bia2 = await connect();
    await call(bia2, 'room:join', { code: sAna.code, playerId: sBia.playerId, token: sBia.token });
    const s = await until(ana, (st) => st.paused === false);
    expect(s.round?.deadline).toBeGreaterThan(Date.now());
  });
});

describe('limite de envios', () => {
  it('recusa rajadas acima do limite', () => {
    const svc = new RoomsService({}, { maxEventsPerSecond: 5, sweepEveryMs: 1_000_000 });
    const fake = { data: {} } as Parameters<RoomsService['isRateLimited']>[0];
    const results = Array.from({ length: 7 }, () => svc.isRateLimited(fake));
    expect(results.filter(Boolean)).toHaveLength(2);
    svc.onModuleDestroy();
  });
});
