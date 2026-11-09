<script setup lang="ts">
import { computed, ref } from 'vue'
import { LIMITS } from '@po/shared'
import { useRoomStore } from '@/stores/room'
import PlayerList from './PlayerList.vue'
import RoomConfigForm from './RoomConfigForm.vue'

const emit = defineEmits<{ leave: [] }>()
const room = useRoomStore()
const copied = ref(false)

const link = computed(() => `${location.origin}/sala/${room.state?.code ?? ''}`)
const canStart = computed(() => room.activePlayers.length >= LIMITS.minPlayers)

async function share() {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
  try {
    if (nav.share) {
      await nav.share({ title: 'Pergunta Oculta', text: 'Bora jogar?', url: link.value })
      return
    }
  } catch {
    /* cancelado ou indisponível: cai para copiar */
  }
  try {
    await navigator.clipboard.writeText(link.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    room.pushToast('info', link.value)
  }
}
</script>

<template>
  <section class="panel code-panel">
    <p class="hint">Código da sala</p>
    <div class="code" data-test="room-code">{{ room.state?.code }}</div>
    <button class="btn ghost small" @click="share">{{ copied ? 'Link copiado!' : 'Compartilhar link' }}</button>
  </section>

  <section class="panel">
    <h2>Jogadores ({{ room.activePlayers.length }}/{{ LIMITS.maxPlayers }})</h2>
    <PlayerList />
  </section>

  <RoomConfigForm />

  <button
    v-if="room.isHost"
    class="btn wide"
    :disabled="!canStart"
    data-test="start"
    @click="room.start()"
  >
    {{ canStart ? 'Começar partida' : 'Esperando mais jogadores…' }}
  </button>
  <p v-else class="hint center">Esperando {{ room.playerName(room.state?.hostId) }} começar a partida.</p>

  <div class="footer">
    <button class="btn ghost small" @click="emit('leave')">Sair da sala</button>
  </div>
</template>

<style scoped>
.code-panel {
  text-align: center;
}
.code-panel .hint {
  margin: 0;
}
.code {
  font: 800 44px Fraunces, serif;
  letter-spacing: 8px;
  color: var(--gold);
  margin: 4px 0 10px;
}
.center {
  text-align: center;
}
.footer {
  margin-top: 14px;
}
</style>
