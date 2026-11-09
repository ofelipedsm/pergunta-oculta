<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
import ToastStack from '@/components/ToastStack.vue'
import { useRoomStore } from '@/stores/room'

const room = useRoomStore()
</script>

<template>
  <div v-if="!room.connected" class="offline">Reconectando ao servidor…</div>
  <main class="wrap">
    <h1>
      <RouterLink to="/">Pergunta <span>Oculta</span></RouterLink>
    </h1>
    <RouterView />
  </main>
  <ToastStack />
</template>

<style scoped>
.offline {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bad);
  color: var(--ink);
  text-align: center;
  font-weight: 700;
  font-size: 14px;
  padding: 8px;
}
</style>
