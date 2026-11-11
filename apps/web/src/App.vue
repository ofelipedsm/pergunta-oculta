<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import ToastStack from '@/components/ToastStack.vue'
import { useRoomStore } from '@/stores/room'

const room = useRoomStore()
const route = useRoute()
/**
 * Na sala, o chat fica sempre à mostra: no celular ocupa o resto da altura da tela (embaixo);
 * no computador fica fixo à direita e o conteúdo abre espaço para ele.
 */
const withChat = computed(() => route.name === 'room' && !!room.state)
</script>

<template>
  <div v-if="!room.connected" class="offline">Reconectando ao servidor…</div>
  <main class="wrap" :class="{ 'with-chat': withChat }">
    <h1>
      <RouterLink to="/">Pergunta <span>Oculta</span></RouterLink>
    </h1>
    <RouterView />
  </main>
  <ToastStack />
</template>

<style scoped>
.with-chat {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: 12px;
}
@media (min-width: 1100px) {
  .with-chat {
    display: block;
    margin-right: 340px;
    padding-bottom: 48px;
  }
}
@media (min-width: 1500px) {
  .with-chat {
    margin-right: auto;
  }
}
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
