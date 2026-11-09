import { beforeEach, describe, expect, it } from 'vitest';
import type { Question } from '@po/shared';
import { GameEngine } from './engine';
import type { EngineResult, Room } from './model';
import { toPublicState } from './public-state';

const QUESTIONS: Question[] = [
  {
    id: 'q1',
    category: 'Marcas e Produtos',
    level: 1,
    question: 'Ford, BYD e Toyota são montadoras de qual produto',
    answers: ['Carro', 'Carros', 'Automóvel'],
  },
  {
    id: 'q2',
    category: 'Animais',
    level: 1,
    question: 'Qual animal tem o pescoço mais comprido de todos',
    answers: ['Girafa'],
  },
];

function setup() {
  let clock = 1_000_000;
  let seq = 0;
  const engine = new GameEngine({
    now: () => clock,
    random: () => 0.5,
    newId: () => `p${++seq}`,
    newToken: () => `t${seq}`,
    questions: QUESTIONS,
  });
  const advance = (ms: number) => {
    clock += ms;
  };
  return { engine, advance };
}

function ok<T>(res: EngineResult<T>): T {
  if (!res.ok) throw new Error(`${res.code}: ${res.message}`);
  return res.data;
}

/** Sala com Ana (dono), Bia e Caio já no lobby. */
function roomWith(engine: GameEngine, names = ['Ana', 'Bia', 'Caio']) {
  const { room, player } = engine.createRoom('ABCD', names[0]!);
  const ids = [player.id];
  for (const n of names.slice(1)) ids.push(ok(engine.join(room, { name: n })).player.id);
  return { room, ids };
}

const round = (room: Room) => room.round!;

describe('lobby', () => {
  it('cria sala com o dono e aceita novos jogadores', () => {
    const { engine } = setup();
    const { room, ids } = roomWith(engine);
    expect(room.hostId).toBe(ids[0]);
    expect(room.players.map((p) => p.name)).toEqual(['Ana', 'Bia', 'Caio']);
  });

  it('evita nomes repetidos', () => {
    const { engine } = setup();
    const { room } = roomWith(engine, ['Ana', 'Ana']);
    expect(room.players.map((p) => p.name)).toEqual(['Ana', 'Ana 2']);
  });

  it('só o dono configura e inicia', () => {
    const { engine } = setup();
    const { room, ids } = roomWith(engine);
    expect(engine.updateConfig(room, ids[1]!, { target: 10 })).toMatchObject({ ok: false, code: 'NOT_HOST' });
    expect(engine.start(room, ids[1]!)).toMatchObject({ ok: false, code: 'NOT_HOST' });
    ok(engine.updateConfig(room, ids[0]!, { target: 10 }));
    expect(room.config.target).toBe(10);
  });

  it('exige pelo menos 2 jogadores', () => {
    const { engine } = setup();
    const { room, ids } = roomWith(engine, ['Ana']);
    expect(engine.start(room, ids[0]!)).toMatchObject({ ok: false, code: 'NOT_ENOUGH_PLAYERS' });
  });

  it('não aceita entrada nova depois que a partida começou, mas aceita reconexão', () => {
    const { engine } = setup();
    const { room, ids } = roomWith(engine);
    ok(engine.start(room, ids[0]!));
    expect(engine.join(room, { name: 'Davi' })).toMatchObject({ ok: false, code: 'GAME_STARTED' });

    const bia = room.players[1]!;
    engine.setConnected(room, bia.id, false);
    const back = ok(engine.join(room, { playerId: bia.id, token: bia.token }));
    expect(back.reconnected).toBe(true);
    expect(bia.connected).toBe(true);
  });

  it('recusa reconexão com token errado', () => {
    const { engine } = setup();
    const { room, ids } = roomWith(engine);
    ok(engine.start(room, ids[0]!));
    expect(engine.join(room, { playerId: ids[1], token: 'errado' })).toMatchObject({ ok: false });
  });
});

describe('modo Banco', () => {
  let engine: GameEngine;
  let room: Room;
  let ids: string[];

  beforeEach(() => {
    ({ engine } = setup());
    ({ room, ids } = roomWith(engine));
    ok(engine.start(room, ids[0]!));
  });

  it('começa em choosing com a vez do primeiro jogador', () => {
    expect(round(room).phase).toBe('choosing');
    expect(round(room).turnPlayerId).toBe(ids[0]);
  });

  it('só o jogador da vez abre palavra e chuta', () => {
    expect(engine.openWord(room, ids[1]!, 0)).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    ok(engine.openWord(room, ids[0]!, 0));
    expect(engine.guess(room, ids[1]!, 'x')).toMatchObject({ ok: false, code: 'NOT_YOUR_TURN' });
    expect(engine.openWord(room, ids[0]!, 1)).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
  });

  it('não deixa abrir a mesma palavra duas vezes', () => {
    ok(engine.openWord(room, ids[0]!, 0));
    ok(engine.guess(room, ids[0]!, 'nada'));
    expect(engine.openWord(room, ids[1]!, 0)).toMatchObject({ ok: false, code: 'WORD_ALREADY_OPEN' });
  });

  it('erro passa a vez e acerto vale as palavras escondidas', () => {
    const total = round(room).words.length;
    ok(engine.openWord(room, ids[0]!, 0));
    ok(engine.guess(room, ids[0]!, 'resposta errada'));
    expect(round(room).turnPlayerId).toBe(ids[1]);

    ok(engine.openWord(room, ids[1]!, 1));
    const answer = round(room).answers[0]!;
    ok(engine.guess(room, ids[1]!, answer));
    expect(room.players[1]!.score).toBe(total - 2);
    expect(round(room).hit?.playerId).toBe(ids[1]);
  });

  it('ponto extra só é oferecido com palavras suficientes escondidas', () => {
    ok(engine.openWord(room, ids[0]!, 0));
    ok(engine.guess(room, ids[0]!, round(room).answers[0]!));
    expect(round(room).phase).toBe('bonus');

    ok(engine.tryBonus(room, ids[0]!, round(room).question));
    expect(round(room).hit?.bonus).toBe('ok');
    expect(room.players[0]!.score).toBe(round(room).words.length - 1 + 1);
    expect(round(room).phase).toBe('revealed');
  });

  it('sem ponto extra quando faltam menos palavras que o mínimo', () => {
    const r = round(room);
    let turn = 0;
    // abre até restarem 2 palavras escondidas, errando em todas
    for (let i = 0; i < r.words.length - 2; i++) {
      const p = r.turnPlayerId!;
      ok(engine.openWord(room, p, i));
      ok(engine.guess(room, p, `errado ${turn++}`));
    }
    const p = r.turnPlayerId!;
    ok(engine.openWord(room, p, r.words.length - 2));
    ok(engine.guess(room, p, r.answers[0]!));
    expect(r.hit?.points).toBe(1);
    expect(r.hit?.bonusAllowed).toBe(false);
    expect(r.phase).toBe('revealed');
  });

  it('erro com todas as palavras abertas encerra a rodada sem pontos', () => {
    const r = round(room);
    for (let i = 0; i < r.words.length; i++) {
      const p = r.turnPlayerId!;
      ok(engine.openWord(room, p, i));
      ok(engine.guess(room, p, 'errado'));
    }
    expect(r.phase).toBe('revealed');
    expect(room.players.every((p) => p.score === 0)).toBe(true);
  });

  it('o dono valida o último erro de outro jogador antes de abrir nova palavra', () => {
    ok(engine.openWord(room, ids[0]!, 0));
    ok(engine.guess(room, ids[0]!, 'errado'));
    ok(engine.openWord(room, ids[1]!, 1));
    ok(engine.guess(room, ids[1]!, 'veiculo'));
    const points = round(room).words.length - 2;

    expect(engine.judge(room, ids[2]!, true)).toMatchObject({ ok: false, code: 'NOT_HOST' });
    ok(engine.judge(room, ids[0]!, true));
    expect(room.players[1]!.score).toBe(points);
  });

  it('o dono não valida o próprio chute', () => {
    ok(engine.openWord(room, ids[0]!, 0));
    ok(engine.guess(room, ids[0]!, 'errado'));
    expect(engine.judge(room, ids[0]!, true)).toMatchObject({ ok: false, code: 'CANNOT_JUDGE_SELF' });
  });

  it('vez estourada conta como erro', () => {
    const { engine: e, advance } = setup();
    const s = roomWith(e);
    ok(e.start(s.room, s.ids[0]!));
    advance(61_000);
    expect(e.onTimeout(s.room)).not.toBeNull();
    expect(s.room.round!.turnPlayerId).toBe(s.ids[1]);
  });

  it('termina quando alguém chega na meta', () => {
    const { engine: e } = setup();
    const s = roomWith(e);
    ok(e.updateConfig(s.room, s.ids[0]!, { target: 3, bonusEnabled: false }));
    ok(e.start(s.room, s.ids[0]!));
    ok(e.openWord(s.room, s.ids[0]!, 0));
    ok(e.guess(s.room, s.ids[0]!, s.room.round!.answers[0]!));
    ok(e.nextRound(s.room, s.ids[0]!));
    expect(s.room.phase).toBe('ended');
    expect(s.room.winnerIds).toEqual([s.ids[0]]);
  });
});

describe('modo Mestre', () => {
  const question = 'Qual fruta amarela o macaco adora comer';

  function masterGame(names?: string[]) {
    const { engine, advance } = setup();
    const { room, ids } = roomWith(engine, names);
    ok(engine.updateConfig(room, ids[0]!, { mode: 'master' }));
    ok(engine.start(room, ids[0]!));
    return { engine, advance, room, ids };
  }

  it('o primeiro mestre escreve e não joga', () => {
    const { engine, room, ids } = masterGame();
    expect(round(room).phase).toBe('writing');
    expect(round(room).masterId).toBe(ids[0]);
    expect(engine.submitQuestion(room, ids[1]!, { question, answers: ['banana'] })).toMatchObject({
      ok: false,
      code: 'NOT_MASTER',
    });
    ok(engine.submitQuestion(room, ids[0]!, { question, answers: ['banana'] }));
    expect(round(room).phase).toBe('choosing');
    expect(round(room).turnPlayerId).toBe(ids[1]);
  });

  it('recusa pergunta curta demais', () => {
    const { engine, room, ids } = masterGame();
    expect(engine.submitQuestion(room, ids[0]!, { question: 'Qual fruta', answers: ['banana'] })).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
  });

  it('chute não reconhecido vai para o mestre julgar; aceito, pontua os dois', () => {
    const { engine, room, ids } = masterGame();
    ok(engine.submitQuestion(room, ids[0]!, { question, answers: ['banana'] }));
    // Bia abre e erra; Caio abre e chuta um sinônimo
    ok(engine.openWord(room, ids[1]!, 0));
    ok(engine.guess(room, ids[1]!, 'macaco'));
    expect(round(room).phase).toBe('judging');
    expect(engine.judge(room, ids[2]!, false)).toMatchObject({ ok: false, code: 'NOT_JUDGE' });
    ok(engine.judge(room, ids[0]!, false));
    expect(round(room).turnPlayerId).toBe(ids[2]);

    ok(engine.openWord(room, ids[2]!, 1));
    // só uma palavra por vez: a segunda abertura é recusada
    expect(engine.openWord(room, ids[2]!, 2)).toMatchObject({ ok: false, code: 'WRONG_PHASE' });
    ok(engine.guess(room, ids[2]!, 'banana nanica'));
    expect(round(room).phase).toBe('judging');
    ok(engine.judge(room, ids[0]!, true));

    const words = round(room).words.length; // 7 palavras, 2 abertas
    expect(room.players[2]!.score).toBe(words - 2);
    expect(round(room).hit?.masterPoints).toBe(1); // metade de 2 abertas
    expect(room.players[0]!.score).toBe(1);
  });

  it('o mestre gira e quem foi mestre volta a jogar', () => {
    const { engine, room, ids } = masterGame();
    ok(engine.submitQuestion(room, ids[0]!, { question, answers: ['banana'] }));
    ok(engine.openWord(room, ids[1]!, 0));
    ok(engine.guess(room, ids[1]!, 'banana'));
    ok(engine.skipBonus(room, ids[1]!));
    ok(engine.nextRound(room, ids[0]!));
    expect(round(room).masterId).toBe(ids[1]);
    ok(engine.submitQuestion(room, ids[1]!, { question, answers: ['banana'] }));
    expect(round(room).turnPlayerId).not.toBe(ids[1]);
  });

  it('com 2 jogadores, um cria e o outro adivinha, alternando', () => {
    const { engine, room, ids } = masterGame(['Felipe', 'Ana']);
    ok(engine.submitQuestion(room, ids[0]!, { question, answers: ['banana'] }));
    expect(round(room).turnPlayerId).toBe(ids[1]);
    ok(engine.openWord(room, ids[1]!, 0));
    ok(engine.guess(room, ids[1]!, 'pera'));
    ok(engine.judge(room, ids[0]!, false));
    expect(round(room).turnPlayerId).toBe(ids[1]); // continua sendo a única que joga
    ok(engine.openWord(room, ids[1]!, 1));
    ok(engine.guess(room, ids[1]!, 'banana'));
    ok(engine.skipBonus(room, ids[1]!));
    ok(engine.nextRound(room, ids[0]!));
    expect(round(room).masterId).toBe(ids[1]);
  });

  it('mestre que não envia a tempo: rodada usa pergunta do banco', () => {
    const { engine, advance, room, ids } = masterGame();
    advance(181_000);
    engine.onTimeout(room);
    expect(round(room).phase).toBe('choosing');
    expect(round(room).source).toBe('bank');
    expect(round(room).masterId).toBeUndefined();
    expect(QUESTIONS.map((q) => q.id)).toContain(round(room).questionId);
    expect(round(room).turnPlayerId).toBe(ids[0]);
  });

  it('julgamento sem resposta conta como recusado', () => {
    const { engine, advance, room, ids } = masterGame();
    ok(engine.submitQuestion(room, ids[0]!, { question, answers: ['banana'] }));
    ok(engine.openWord(room, ids[1]!, 0));
    ok(engine.guess(room, ids[1]!, 'pera'));
    advance(21_000);
    engine.onTimeout(room);
    expect(round(room).phase).toBe('choosing');
    expect(room.players[1]!.score).toBe(0);
  });

  it('mestre fora do ar: o dono julga', () => {
    const { engine, room, ids } = masterGame(['Ana', 'Bia', 'Caio']);
    ok(engine.submitQuestion(room, ids[0]!, { question, answers: ['banana'] }));
    // Ana é mestre e dona; derruba Ana e passa a posse
    engine.setConnected(room, ids[0]!, false);
    engine.transferHost(room);
    ok(engine.openWord(room, ids[1]!, 0));
    ok(engine.guess(room, ids[1]!, 'pera'));
    expect(engine.judgeId(room)).toBe(room.hostId);
  });

  it('ponto extra errado vai para o mestre, que pode aceitar', () => {
    const { engine, room, ids } = masterGame();
    ok(engine.submitQuestion(room, ids[0]!, { question, answers: ['banana'] }));
    ok(engine.openWord(room, ids[1]!, 0));
    ok(engine.guess(room, ids[1]!, 'banana'));
    expect(round(room).phase).toBe('bonus');
    ok(engine.tryBonus(room, ids[1]!, 'qual fruta o macaco come'));
    expect(round(room).phase).toBe('judging');
    expect(round(room).pending?.kind).toBe('bonus');
    ok(engine.judge(room, ids[0]!, true));
    expect(round(room).hit?.bonus).toBe('ok');
    expect(round(room).phase).toBe('revealed');
  });
});

describe('modo Misto', () => {
  it('alterna banco e mestre', () => {
    const { engine } = setup();
    const { room, ids } = roomWith(engine);
    ok(engine.updateConfig(room, ids[0]!, { mode: 'mixed', bonusEnabled: false }));
    ok(engine.start(room, ids[0]!));
    expect(round(room).source).toBe('bank');
    ok(engine.openWord(room, round(room).turnPlayerId!, 0));
    ok(engine.guess(room, round(room).turnPlayerId!, round(room).answers[0]!));
    ok(engine.nextRound(room, ids[0]!));
    expect(round(room).source).toBe('master');
    expect(round(room).phase).toBe('writing');
  });
});

describe('saída de jogadores', () => {
  it('jogador da vez sai: a vez passa', () => {
    const { engine } = setup();
    const { room, ids } = roomWith(engine);
    ok(engine.start(room, ids[0]!));
    ok(engine.leave(room, ids[0]!));
    expect(round(room).turnPlayerId).toBe(ids[1]);
    expect(room.hostId).toBe(ids[1]);
  });

  it('sobra 1 jogador: fim de jogo', () => {
    const { engine } = setup();
    const { room, ids } = roomWith(engine, ['Ana', 'Bia']);
    ok(engine.start(room, ids[0]!));
    ok(engine.leave(room, ids[1]!));
    expect(room.phase).toBe('ended');
  });
});

describe('toPublicState', () => {
  it('quem adivinha nunca recebe pergunta nem respostas durante a rodada', () => {
    const { engine } = setup();
    const { room, ids } = roomWith(engine);
    ok(engine.start(room, ids[0]!));
    ok(engine.openWord(room, ids[0]!, 0));

    const view = toPublicState(room, ids[1]!);
    const json = JSON.stringify(view);
    const r = round(room);
    expect(view.round?.question).toBeUndefined();
    expect(view.round?.answers).toBeUndefined();
    expect(view.round?.answer).toBeUndefined();
    expect(view.round?.words.filter((w) => w !== null)).toEqual([r.words[0]]);
    for (const a of r.answers) expect(json.toLowerCase()).not.toContain(`"${a.toLowerCase()}"`);
    expect(json).not.toContain('"token"');
  });

  it('depois do acerto mostra a resposta, mas a pergunta só no fim', () => {
    const { engine } = setup();
    const { room, ids } = roomWith(engine);
    ok(engine.start(room, ids[0]!));
    ok(engine.openWord(room, ids[0]!, 0));
    ok(engine.guess(room, ids[0]!, round(room).answers[0]!));
    expect(round(room).phase).toBe('bonus');
    const during = toPublicState(room, ids[1]!);
    expect(during.round?.answer).toBe(round(room).answers[0]);
    expect(during.round?.question).toBeUndefined();

    ok(engine.skipBonus(room, ids[0]!));
    const after = toPublicState(room, ids[1]!);
    expect(after.round?.question).toBe(round(room).question);
  });

  it('o mestre vê a pergunta e as respostas', () => {
    const { engine } = setup();
    const { room, ids } = roomWith(engine);
    ok(engine.updateConfig(room, ids[0]!, { mode: 'master' }));
    ok(engine.start(room, ids[0]!));
    ok(
      engine.submitQuestion(room, ids[0]!, {
        question: 'Qual fruta amarela o macaco adora comer',
        answers: ['banana', 'banana nanica'],
      }),
    );
    const master = toPublicState(room, ids[0]!);
    expect(master.me.isMaster).toBe(true);
    expect(master.round?.answers).toEqual(['banana', 'banana nanica']);
    expect(master.round?.words.every((w) => w !== null)).toBe(true);
    const player = toPublicState(room, ids[1]!);
    expect(player.round?.words.every((w) => w === null)).toBe(true);
  });
});
