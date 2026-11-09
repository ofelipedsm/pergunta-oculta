<script setup lang="ts">
import { computed } from 'vue'
import { useRoomStore } from '@/stores/room'

const emit = defineEmits<{ leave: [] }>()
const room = useRoomStore()
const ranking = computed(() => [...room.players].sort((a, b) => b.score - a.score))
const winners = computed(() => room.state?.winnerIds ?? [])
const title = computed(() => {
  const names = winners.value.map((id) => room.playerName(id))
  if (!names.length) return 'Fim de jogo'
  return names.length === 1 ? `${names[0]} venceu!` : `Empate: ${names.join(' e ')}`
})
</script>

<template>
  <section class="panel" data-test="end">
    <h2>{{ title }}</h2>
    <ol class="rank">
      <li v-for="(p, i) in ranking" :key="p.id" :class="{ win: winners.includes(p.id) }">
        <span>{{ i + 1 }}º {{ p.name }}<small v-if="p.left"> (saiu)</small></span>
        <b>{{ p.score }} pts</b>
      </li>
    </ol>
  </section>
  <button v-if="room.isHost" class="btn wide" data-test="restart" @click="room.restart()">Jogar de novo</button>
  <p v-else class="hint">Esperando {{ room.playerName(room.state?.hostId) }} decidir se joga de novo.</p>
  <div class="footer">
    <button class="btn ghost small" @click="emit('leave')">Sair da sala</button>
  </div>
</template>

<style scoped>
.rank {
  list-style: none;
  padding: 0;
  margin: 0;
}
.rank li {
  display: flex;
  justify-content: space-between;
  padding: 10px 4px;
  border-bottom: 1px solid var(--bg3);
  font-size: 17px;
}
.rank li.win {
  color: var(--gold);
  font-weight: 700;
}
.rank b {
  font-family: Fraunces, serif;
}
small {
  color: var(--muted);
}
.footer {
  margin-top: 14px;
}
</style>
