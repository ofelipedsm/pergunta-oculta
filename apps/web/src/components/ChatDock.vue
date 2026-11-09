<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LIMITS } from '@po/shared'
import { useRoomStore } from '@/stores/room'

/**
 * Chat da sala. No computador fica fixo à direita; no celular abre por um botão flutuante.
 * Mostra as mensagens dos jogadores e as automáticas do jogo (vez, chutes, acertos).
 */
const room = useRoomStore()
const QUICK = ['😂', '👏', '🤔', '😱', '🔥']

const messages = computed(() => room.state?.chat ?? [])
const meId = computed(() => room.me?.id)
const text = ref('')
const sending = ref(false)
const list = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)

const wide = ref(false)
const open = ref(false)
const visible = computed(() => wide.value || open.value)
const lastSeen = ref(0)

let mq: MediaQueryList | undefined
const onMq = () => (wide.value = !!mq?.matches)
onMounted(() => {
  mq = window.matchMedia('(min-width: 1100px)')
  onMq()
  mq.addEventListener('change', onMq)
  lastSeen.value = messages.value.at(-1)?.id ?? 0
  scrollToEnd(true)
})
onBeforeUnmount(() => mq?.removeEventListener('change', onMq))

/** Só mensagens de outros jogadores contam como não lidas; as automáticas não. */
const unread = computed(
  () => messages.value.filter((m) => m.id > lastSeen.value && m.kind === 'user' && m.playerId !== meId.value).length,
)

function nearBottom() {
  const el = list.value
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80
}

async function scrollToEnd(force = false) {
  if (!force && !nearBottom()) return
  await nextTick()
  if (list.value) list.value.scrollTop = list.value.scrollHeight
}

watch(
  () => messages.value.at(-1)?.id,
  (id) => {
    if (visible.value && id) lastSeen.value = id
    void scrollToEnd()
  },
)

watch(visible, (v) => {
  if (!v) return
  lastSeen.value = messages.value.at(-1)?.id ?? 0
  void scrollToEnd(true)
  if (!wide.value) void nextTick(() => input.value?.focus())
})

async function send(value = text.value) {
  const v = value.trim()
  if (!v || sending.value) return
  sending.value = true
  const ok = await room.sendChat(v)
  sending.value = false
  if (ok && value === text.value) text.value = ''
  void scrollToEnd(true)
}

function time(at: number) {
  return new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <button
    v-if="!wide && !open"
    class="fab"
    data-test="chat-open"
    aria-label="Abrir o chat"
    @click="open = true"
  >
    Chat
    <span v-if="unread" class="badge" data-test="chat-unread">{{ unread }}</span>
  </button>

  <aside v-if="visible" class="chat" :class="{ sheet: !wide }" data-test="chat" aria-label="Chat da sala">
    <header>
      <b>Chat da sala</b>
      <button v-if="!wide" class="close" aria-label="Fechar o chat" @click="open = false">×</button>
    </header>

    <div ref="list" class="list" aria-live="polite">
      <p v-if="!messages.length" class="empty">Ninguém falou nada ainda. Combinem as regras por aqui!</p>
      <template v-for="m in messages" :key="m.id">
        <div v-if="m.kind === 'system'" class="sys" :class="m.tone" data-test="chat-system">{{ m.text }}</div>
        <div v-else class="msg" :class="{ mine: m.playerId === meId }" data-test="chat-user">
          <div class="meta">
            <span class="who" :style="{ color: room.playerColor(m.playerId) }">{{ room.playerName(m.playerId) }}</span>
            <span class="at">{{ time(m.at) }}</span>
          </div>
          <div class="bubble">{{ m.text }}</div>
        </div>
      </template>
    </div>

    <div class="quick">
      <button v-for="q in QUICK" :key="q" class="emoji" :aria-label="`Enviar ${q}`" @click="send(q)">{{ q }}</button>
    </div>
    <form class="compose" @submit.prevent="send()">
      <input
        ref="input"
        v-model="text"
        class="textin"
        :maxlength="LIMITS.chatMax"
        placeholder="Mensagem para a sala…"
        autocomplete="off"
        data-test="chat-input"
      />
      <button class="btn" type="submit" :disabled="sending || !text.trim()" data-test="chat-send">Enviar</button>
    </form>
  </aside>
</template>

<style scoped>
.fab {
  position: fixed;
  right: 16px;
  bottom: 18px;
  z-index: 25;
  border: none;
  border-radius: 999px;
  padding: 12px 18px;
  background: var(--gold);
  color: var(--ink);
  font: 700 15px 'DM Sans';
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  cursor: pointer;
}
.badge {
  display: inline-block;
  min-width: 20px;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bad);
  color: var(--ink);
  font-size: 12px;
}

.chat {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 340px;
  z-index: 15;
  display: flex;
  flex-direction: column;
  background: #171a33;
  border-left: 1px solid var(--bg3);
}
.chat.sheet {
  top: auto;
  left: 0;
  width: auto;
  height: 72vh;
  z-index: 26;
  border-left: none;
  border-top: 1px solid var(--bg3);
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--bg3);
  font-family: Fraunces, serif;
  font-size: 17px;
}
.close {
  background: none;
  border: none;
  color: var(--muted);
  font-size: 26px;
  line-height: 1;
  cursor: pointer;
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.empty {
  color: var(--muted);
  font-size: 13px;
  text-align: center;
  margin-top: 20px;
}
.sys {
  align-self: center;
  max-width: 92%;
  text-align: center;
  font-size: 12.5px;
  color: var(--muted);
  background: rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 4px 10px;
}
.sys.hit {
  color: var(--ok);
}
.sys.miss {
  color: var(--bad);
}

.msg {
  align-self: flex-start;
  max-width: 85%;
}
.msg.mine {
  align-self: flex-end;
  text-align: right;
}
.meta {
  font-size: 11.5px;
  margin-bottom: 2px;
}
.who {
  font-weight: 700;
}
.at {
  color: var(--muted);
  margin-left: 6px;
}
.bubble {
  display: inline-block;
  background: var(--bg3);
  border-radius: 12px;
  padding: 7px 11px;
  font-size: 14.5px;
  line-height: 1.35;
  word-break: break-word;
  text-align: left;
}
.mine .bubble {
  background: var(--gold);
  color: var(--ink);
}

.quick {
  display: flex;
  gap: 6px;
  padding: 6px 12px 0;
}
.emoji {
  background: var(--bg2);
  border: 1px solid var(--bg3);
  border-radius: 10px;
  font-size: 18px;
  padding: 4px 8px;
  cursor: pointer;
}
.compose {
  display: flex;
  gap: 8px;
  padding: 10px 12px 14px;
}
.compose .textin {
  flex: 1;
  padding: 10px 12px;
  font-size: 15px;
}
.compose .btn {
  padding: 10px 14px;
  font-size: 14px;
}
</style>
