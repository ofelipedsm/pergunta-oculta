import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  Ack,
  ClientToServerEvents,
  MasterSubmitInput,
  PublicRoomState,
  RoomConfig,
  Session,
  ToastKind,
} from '@po/shared'
import { socket } from '@/socket'
import { loadSession, saveName, saveSession } from '@/session'

export interface ToastItem {
  id: number
  kind: ToastKind
  text: string
}

type Result<T = undefined> = { ok: true; data: T } | { ok: false; message: string }

let toastSeq = 0

/**
 * Estado da sala vindo do servidor + ações que viram eventos.
 * O front não aplica regra nenhuma: só desenha o room:state e pede coisas.
 */
export const useRoomStore = defineStore('room', () => {
  const state = ref<PublicRoomState | null>(null)
  const connected = ref(socket.connected)
  const toasts = ref<ToastItem[]>([])
  const closedReason = ref<string | null>(null)
  const session = ref<Session | null>(loadSession())

  // ------------------------------------------------------------ derivados
  const me = computed(() => state.value?.me)
  const round = computed(() => state.value?.round)
  const players = computed(() => state.value?.players ?? [])
  const activePlayers = computed(() => players.value.filter((p) => !p.left))
  const isHost = computed(() => !!state.value?.me.isHost)
  const isMaster = computed(() => !!state.value?.me.isMaster)
  const isMyTurn = computed(() => !!round.value && round.value.turnPlayerId === me.value?.id)
  const isJudge = computed(() => !!state.value?.judgeId && state.value.judgeId === me.value?.id)
  const hiddenCount = computed(() => (round.value ? round.value.wordCount - round.value.revealed.length : 0))

  function playerName(id: string | undefined): string {
    return players.value.find((p) => p.id === id)?.name ?? 'Alguém'
  }
  function playerColor(id: string | undefined): string {
    return players.value.find((p) => p.id === id)?.color ?? '#fff'
  }

  // ------------------------------------------------------------ socket
  socket.on('connect', () => {
    connected.value = true
    // Voltou a rede: reentra na sala com o token guardado.
    if (session.value && state.value) void rejoin(session.value.code)
  })
  socket.on('disconnect', () => {
    connected.value = false
  })
  socket.on('room:state', (s) => {
    state.value = s
    closedReason.value = null
  })
  // Avisos informativos já aparecem no chat; o toast fica só para acertos e erros.
  socket.on('room:toast', (t) => {
    if (t.kind !== 'info') pushToast(t.kind, t.text)
  })
  socket.on('room:closed', ({ reason }) => {
    closedReason.value = reason
    state.value = null
    setSession(null)
  })

  function pushToast(kind: ToastKind, text: string) {
    const id = ++toastSeq
    toasts.value.push({ id, kind, text })
    if (toasts.value.length > 2) toasts.value.shift()
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 3000)
  }

  function setSession(s: Session | null) {
    session.value = s
    saveSession(s)
  }

  /** Emite e espera a confirmação do servidor (com prazo de 8 s). */
  async function emit<T = undefined>(
    event: keyof ClientToServerEvents,
    payload?: unknown,
  ): Promise<Result<T>> {
    try {
      const timed = socket.timeout(8000) as unknown as {
        emitWithAck: (ev: string, ...args: unknown[]) => Promise<Ack<T>>
      }
      const res = payload === undefined ? await timed.emitWithAck(event) : await timed.emitWithAck(event, payload)
      if (res.ok) return { ok: true, data: (res as { data: T }).data }
      return { ok: false, message: res.message }
    } catch {
      return { ok: false, message: 'Sem resposta do servidor. Verifique a conexão.' }
    }
  }

  /** Para ações de jogo: mostra o erro como aviso em vez de devolver. */
  async function act(event: keyof ClientToServerEvents, payload?: unknown): Promise<boolean> {
    const res = await emit(event, payload)
    if (!res.ok) pushToast('miss', res.message)
    return res.ok
  }

  // ------------------------------------------------------------ entrar e sair
  async function createRoom(name: string): Promise<Result<Session>> {
    saveName(name)
    const res = await emit<Session>('room:create', { name })
    if (res.ok) setSession(res.data)
    return res
  }

  async function joinRoom(code: string, name: string): Promise<Result<Session>> {
    saveName(name)
    const res = await emit<Session>('room:join', { code: code.toUpperCase(), name })
    if (res.ok) setSession(res.data)
    return res
  }

  /** Reentra com o token guardado. Falhou: esquece a sessão. */
  async function rejoin(code: string): Promise<boolean> {
    const s = session.value
    if (!s || s.code !== code.toUpperCase()) return false
    const res = await emit<Session>('room:join', { code: s.code, playerId: s.playerId, token: s.token })
    if (!res.ok) {
      setSession(null)
      return false
    }
    return true
  }

  async function leave() {
    await emit('room:leave')
    state.value = null
    setSession(null)
  }

  // ------------------------------------------------------------ ações
  const setConfig = (patch: Partial<RoomConfig>) => act('room:config', patch)
  const kick = (playerId: string) => act('room:kick', { playerId })
  const start = () => act('game:start')
  const endGame = () => act('game:end')
  const restart = () => act('game:restart')
  const submitQuestion = (input: MasterSubmitInput) => emit('master:submit', input)
  const openWord = (index: number) => act('round:open', { index })
  const guess = (text: string) => act('round:guess', { text })
  const judge = (accept: boolean) => act('judge:decide', { accept })
  const tryBonus = (text: string) => act('bonus:try', { text })
  const skipBonus = () => act('bonus:skip')
  const nextRound = () => act('round:next')
  const skipTurn = () => act('turn:skip')
  const sendChat = (text: string) => act('chat:send', { text })
  const startSkip = () => act('skip:start')
  const voteSkip = (accept: boolean) => act('skip:vote', { accept })

  return {
    state,
    connected,
    toasts,
    closedReason,
    session,
    me,
    round,
    players,
    activePlayers,
    isHost,
    isMaster,
    isMyTurn,
    isJudge,
    hiddenCount,
    playerName,
    playerColor,
    pushToast,
    createRoom,
    joinRoom,
    rejoin,
    leave,
    setConfig,
    kick,
    start,
    endGame,
    restart,
    submitQuestion,
    openWord,
    guess,
    judge,
    tryBonus,
    skipBonus,
    nextRound,
    skipTurn,
    sendChat,
    startSkip,
    voteSkip,
  }
})
