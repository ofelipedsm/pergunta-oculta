<script setup lang="ts">
import { computed } from 'vue'
import { LIMITS } from '@po/shared'
import { useRoomStore } from '@/stores/room'
import InviteCard from './InviteCard.vue'
import PlayerList from './PlayerList.vue'
import RoomConfigForm from './RoomConfigForm.vue'

const emit = defineEmits<{ leave: [] }>()
const room = useRoomStore()
const canStart = computed(() => room.activePlayers.length >= LIMITS.minPlayers)

</script>

<template>
  <InviteCard :code="room.state?.code ?? ''" />

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
.center {
  text-align: center;
}
.footer {
  margin-top: 14px;
}
</style>
