<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { LIMITS } from '@po/shared'
import { useRoomStore } from '@/stores/room'

/**
 * Chat da sala, com as mensagens automáticas do jogo (vez, chutes, acertos).
 *
 * - Computador (≥ 1100 px): fixo à direita.
 * - Celular: sempre aberto embaixo, ocupando o espaço que sobra da tela; as mensagens rolam por dentro.
 *   O botão de expandir abre em tela cheia. Ao tocar no campo de mensagem, o chat cresce para a área
 *   visível acima do teclado e, quando o teclado fecha, volta ao tamanho compacto.
 * O campo do chat é discreto de propósito: o campo de destaque da tela é sempre o do chute.
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
/** Celular: chat em tela cheia (pelo botão ou digitando). */
const expanded = ref(false)
/** Expandiu porque a pessoa tocou no campo: fecha sozinho quando o teclado some. */
const byTyping = ref(false)
const typing = ref(false)

/** Área visível de verdade (descontando o teclado no iPhone). */
const vv = ref({ top: 0, height: 0 })
function onViewport() {
  const v = window.visualViewport
  vv.value = { top: v?.offsetTop ?? 0, height: v?.height ?? window.innerHeight }
  if (typing.value) void scrollToEnd(true)
}

let mq: MediaQueryList | undefined
const onMq = () => {
  wide.value = !!mq?.matches
  if (wide.value) expanded.value = false
}
onMounted(() => {
  mq = window.matchMedia('(min-width: 1100px)')
  onMq()
  mq.addEventListener('change', onMq)
  window.visualViewport?.addEventListener('resize', onViewport)
  window.visualViewport?.addEventListener('scroll', onViewport)
  onViewport()
  void scrollToEnd(true)
})
onBeforeUnmount(() => {
  mq?.removeEventListener('change', onMq)
  window.visualViewport?.removeEventListener('resize', onViewport)
  window.visualViewport?.removeEventListener('scroll', onViewport)
})

const sheetStyle = computed(() =>
  !wide.value && expanded.value && typing.value
    ? { top: `${vv.value.top}px`, height: `${vv.value.height}px`, bottom: 'auto' }
    : undefined,
)

/** A pessoa está vendo o fim da conversa? Se rolou para cima para ler, não puxamos de volta. */
const stick = ref(true)
function onScroll() {
  const el = list.value
  if (el) stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

async function scrollToEnd(force = false) {
  if (!force && !stick.value) return
  await nextTick()
  if (list.value) list.value.scrollTop = list.value.scrollHeight
  stick.value = true
}

// O chat muda de tamanho quando a tela do jogo cresce ou encolhe: continua mostrando o fim.
let ro: ResizeObserver | undefined
watch(list, (el, _, onCleanup) => {
  if (!el || typeof ResizeObserver === 'undefined') return
  ro = new ResizeObserver(() => {
    if (stick.value) el.scrollTop = el.scrollHeight
  })
  ro.observe(el)
  onCleanup(() => ro?.disconnect())
})

watch(
  () => messages.value.at(-1)?.id,
  () => void scrollToEnd(),
)
watch(expanded, () => void scrollToEnd(true))

function onFocus() {
  typing.value = true
  if (wide.value) return
  if (!expanded.value) {
    expanded.value = true
    byTyping.value = true
  }
  void scrollToEnd(true)
}

function onBlur() {
  typing.value = false
  if (byTyping.value) {
    byTyping.value = false
    expanded.value = false
  }
}

function expand() {
  expanded.value = true
  byTyping.value = false
}

function collapse() {
  expanded.value = false
  byTyping.value = false
  input.value?.blur()
}

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
  <div class="slot" :class="{ wide }">
    <aside
      class="chat"
      :class="wide ? 'side' : expanded ? 'sheet' : 'inline'"
      :style="sheetStyle"
      data-test="chat"
      aria-label="Chat da sala"
    >
      <header>
        <b>Chat da sala</b>
        <template v-if="!wide">
          <button v-if="!expanded" class="icon" data-test="chat-expand" aria-label="Expandir o chat" @click="expand">
            Expandir ⤢
          </button>
          <button
            v-else
            class="icon close"
            data-test="chat-collapse"
            aria-label="Recolher o chat"
            @pointerdown.prevent
            @click="collapse"
          >
            ×
          </button>
        </template>
      </header>

      <div ref="list" class="list" aria-live="polite" @scroll.passive="onScroll">
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

      <div v-if="wide || expanded" class="quick">
        <button
          v-for="q in QUICK"
          :key="q"
          class="emoji"
          :aria-label="`Enviar ${q}`"
          @pointerdown.prevent
          @click="send(q)"
        >
          {{ q }}
        </button>
      </div>
      <form class="compose" @submit.prevent="send()">
        <input
          ref="input"
          v-model="text"
          class="chatin"
          :maxlength="LIMITS.chatMax"
          placeholder="Mensagem para a sala…"
          autocomplete="off"
          enterkeyhint="send"
          data-test="chat-input"
          @focus="onFocus"
          @blur="onBlur"
        />
        <button
          class="send"
          type="submit"
          :disabled="sending || !text.trim()"
          aria-label="Enviar mensagem"
          data-test="chat-send"
          @pointerdown.prevent
        >
          Enviar
        </button>
      </form>
    </aside>
  </div>
</template>

<style scoped>
/* No celular, o slot ocupa o resto da altura da tela; no computador, não ocupa nada. */
.slot {
  flex: 1 1 0;
  min-height: 200px;
  display: flex;
  margin-top: 4px;
}
.slot.wide {
  flex: none;
  min-height: 0;
  margin: 0;
}

.chat {
  display: flex;
  flex-direction: column;
  background: #171a33;
}
.chat.inline {
  flex: 1;
  min-height: 0;
  border: 1px solid var(--bg3);
  border-radius: 16px;
  overflow: hidden;
}
.chat.side {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 340px;
  z-index: 15;
  border-left: 1px solid var(--bg3);
}
.chat.sheet {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  height: 80vh;
  height: 80dvh;
  z-index: 26;
  border-top: 1px solid var(--bg3);
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -10px 40px rgba(0, 0, 0, 0.5);
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--bg3);
  font-family: Fraunces, serif;
  font-size: 15px;
}
.side header,
.sheet header {
  padding: 12px 16px;
  font-size: 17px;
}
.icon {
  background: none;
  border: none;
  color: var(--muted);
  font: 600 13px 'DM Sans';
  cursor: pointer;
  padding: 4px 6px;
}
.close {
  font-size: 26px;
  line-height: 1;
}

.list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.empty {
  color: var(--muted);
  font-size: 13px;
  text-align: center;
  margin-top: 12px;
}
/* Mensagens do jogo: discretas, para não competir com a conversa. */
.sys {
  align-self: center;
  max-width: 94%;
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  padding: 1px 8px;
}
.sys.hit {
  color: var(--ok);
}
.sys.miss {
  color: var(--bad);
  opacity: 0.85;
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
  padding: 6px 10px;
  font-size: 14.5px;
  line-height: 1.35;
  word-break: break-word;
  text-align: left;
}
.mine .bubble {
  background: #4a4f86;
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
  gap: 6px;
  padding: 8px 10px 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}
/* Campo discreto: menor e sem a borda dourada do campo de chute. */
.chatin {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border-radius: 999px;
  border: 1px solid var(--bg3);
  background: transparent;
  color: #fff;
  font: 500 16px 'DM Sans'; /* 16px evita o zoom automático do iPhone */
  outline: none;
}
.chatin:focus {
  border-color: var(--muted);
  background: #141833;
}
.send {
  border: 1px solid var(--bg3);
  background: var(--bg3);
  color: #fff;
  border-radius: 999px;
  padding: 0 14px;
  font: 700 13px 'DM Sans';
  cursor: pointer;
}
.send:disabled {
  opacity: 0.45;
  cursor: default;
}
</style>
