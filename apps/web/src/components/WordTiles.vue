<script setup lang="ts">
import { computed } from 'vue'
import { useRoomStore } from '@/stores/room'

const room = useRoomStore()
const r = computed(() => room.round!)
const canOpen = computed(() => r.value.phase === 'choosing' && room.isMyTurn)
const ended = computed(() => r.value.phase === 'revealed')

/** Para cada quadrado: aberto para todos, só visível para o mestre, ou escondido. */
const tiles = computed(() =>
  r.value.words.map((word, i) => {
    const revealed = r.value.revealed.includes(i)
    const kind: 'open' | 'peek' | 'hidden' =
      ended.value || revealed ? 'open' : word !== null ? 'peek' : 'hidden'
    return { i, word, kind, last: r.value.lastOpened === i && !ended.value }
  }),
)

function open(i: number) {
  if (canOpen.value) void room.openWord(i)
}
</script>

<template>
  <div class="tiles" data-test="tiles">
    <button
      v-for="t in tiles"
      :key="t.i"
      class="tile"
      :class="{
        open: t.kind === 'open',
        peek: t.kind === 'peek',
        last: t.last,
        clickable: canOpen && t.kind !== 'open',
        locked: !canOpen && t.kind === 'hidden',
      }"
      :disabled="!canOpen || t.kind === 'open'"
      :aria-label="t.kind === 'open' ? (t.word ?? '') : `Abrir palavra ${t.i + 1}`"
      :data-test="`tile-${t.i}`"
      @click="open(t.i)"
    >
      {{ t.kind === 'hidden' ? t.i + 1 : t.word }}
    </button>
    <span class="qmark">?</span>
  </div>
  <p v-if="room.isMaster && !ended" class="hint">
    Você é o mestre: vê a pergunta inteira. As palavras tracejadas ainda estão escondidas para os outros.
  </p>
</template>
