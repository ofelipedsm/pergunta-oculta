<script setup lang="ts">
import { computed } from 'vue'
import { useRoomStore } from '@/stores/room'

const room = useRoomStore()
const activeId = computed(() => {
  const r = room.round
  if (!r) return undefined
  if (r.phase === 'choosing' || r.phase === 'guessing') return r.turnPlayerId
  if (r.phase === 'writing' || r.phase === 'judging') return r.phase === 'judging' ? room.state?.judgeId : r.masterId
  if (r.phase === 'bonus') return r.hit?.playerId
  return undefined
})
</script>

<template>
  <div class="scores">
    <div
      v-for="p in room.players.filter((x) => !x.left)"
      :key="p.id"
      class="player"
      :class="{ turn: p.id === activeId, off: !p.connected, waiting: p.spectating }"
    >
      <div class="nm" :style="{ color: p.color }">
        {{ p.name }}<span v-if="p.id === room.round?.masterId" class="badge">mestre</span>
      </div>
      <div v-if="p.spectating" class="next">entra na próxima</div>
      <div class="pts">{{ p.score }}</div>
    </div>
  </div>
</template>

<style scoped>
.scores {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}
.player {
  flex: 1 1 110px;
  background: var(--bg2);
  border-radius: 14px;
  padding: 9px 12px;
  border: 2px solid transparent;
  transition: border-color 0.2s;
}
.player.turn {
  border-color: var(--gold);
}
.player.waiting {
  border-style: dashed;
  border-color: var(--bg3);
}
.next {
  font-size: 11px;
  color: var(--muted);
}
.player.off {
  opacity: 0.5;
}
.nm {
  font-weight: 700;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.badge {
  margin-left: 6px;
  font-size: 10px;
  background: #b59cff;
  color: var(--ink);
  border-radius: 999px;
  padding: 1px 6px;
  vertical-align: middle;
}
.pts {
  font: 800 28px Fraunces, serif;
  line-height: 1.1;
}
</style>
