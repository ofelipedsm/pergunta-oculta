import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, ServerToClientEvents } from '@po/shared'

export type GameClient = Socket<ServerToClientEvents, ClientToServerEvents>

export const SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3000'

/** Conexão única com o servidor. O socket.io reconecta sozinho quando a rede cai. */
export const socket: GameClient = io(SERVER_URL, {
  transports: ['websocket'],
  autoConnect: true,
  reconnectionDelay: 500,
  reconnectionDelayMax: 3000,
})
