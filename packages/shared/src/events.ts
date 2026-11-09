import type { PublicRoomState } from './types';
import type {
  CreateRoomInput,
  JoinRoomInput,
  MasterSubmitInput,
  RoomConfigInput,
} from './schemas';

export type ErrorCode =
  | 'INVALID'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'GAME_STARTED'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_MASTER'
  | 'NOT_JUDGE'
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'NOT_ENOUGH_PLAYERS'
  | 'NO_QUESTIONS'
  | 'WORD_ALREADY_OPEN'
  | 'CANNOT_JUDGE_SELF'
  | 'RATE_LIMITED';

export type AckOk<T = undefined> = T extends undefined ? { ok: true } : { ok: true; data: T };
export type AckErr = { ok: false; code: ErrorCode; message: string };
export type Ack<T = undefined> = AckOk<T> | AckErr;
export type AckFn<T = undefined> = (res: Ack<T>) => void;

export interface Session {
  code: string;
  playerId: string;
  token: string;
}

/** Eventos que o celular envia. Todos respondem pelo callback de confirmação. */
export interface ClientToServerEvents {
  'room:create': (input: CreateRoomInput, ack: AckFn<Session>) => void;
  'room:join': (input: JoinRoomInput, ack: AckFn<Session>) => void;
  'room:leave': (ack: AckFn) => void;
  'room:config': (input: RoomConfigInput, ack: AckFn) => void;
  'room:kick': (input: { playerId: string }, ack: AckFn) => void;
  'game:start': (ack: AckFn) => void;
  'game:end': (ack: AckFn) => void;
  'game:restart': (ack: AckFn) => void;
  'master:submit': (input: MasterSubmitInput, ack: AckFn) => void;
  'round:open': (input: { index: number }, ack: AckFn) => void;
  'round:guess': (input: { text: string }, ack: AckFn) => void;
  'judge:decide': (input: { accept: boolean }, ack: AckFn) => void;
  'bonus:try': (input: { text: string }, ack: AckFn) => void;
  'bonus:skip': (ack: AckFn) => void;
  'round:next': (ack: AckFn) => void;
  'turn:skip': (ack: AckFn) => void;
  'chat:send': (input: { text: string }, ack: AckFn) => void;
}

export type ToastKind = 'hit' | 'miss' | 'info';

/** Eventos que o servidor envia. room:state sempre leva o estado completo. */
export interface ServerToClientEvents {
  'room:state': (state: PublicRoomState) => void;
  'room:toast': (toast: { kind: ToastKind; text: string }) => void;
  'room:closed': (info: { reason: string }) => void;
}
