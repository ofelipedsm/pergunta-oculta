<script setup lang="ts">
import { useRoomStore } from '@/stores/room'

const room = useRoomStore()
</script>

<template>
  <ul class="list">
    <li v-for="p in room.activePlayers" :key="p.id">
      <span class="dot" :style="{ background: p.color }" />
      <span class="name">
        {{ p.name }}
        <small v-if="p.id === room.me?.id">(você)</small>
        <small v-if="p.id === room.state?.hostId">· dono</small>
        <small v-if="!p.connected" class="off">· desconectado</small>
      </span>
      <button
        v-if="room.isHost && p.id !== room.me?.id"
        class="btn ghost small"
        aria-label="Remover jogador"
        @click="room.kick(p.id)"
      >
        Remover
      </button>
    </li>
  </ul>
</template>

<style scoped>
.list {
  list-style: none;
  padding: 0;
  margin: 0;
}
li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--bg3);
}
li:last-child {
  border-bottom: none;
}
.dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex: 0 0 12px;
}
.name {
  flex: 1;
  font-weight: 600;
}
small {
  color: var(--muted);
  font-weight: 400;
}
.off {
  color: var(--bad);
}
</style>
